import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { buildSync } from "esbuild";
import { fileRevision, saveMdkSnapshot } from "../electron/mdk";

test("CLI edits MDK directly, guards writes and shares the desktop write lock", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mardikor-cli-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cli = path.join(root, "mardikor.cjs");
  buildSync({
    entryPoints: ["cli/mardikor.ts"],
    outfile: cli,
    bundle: true,
    format: "cjs",
    platform: "node",
  });
  const file = path.join(root, "测试 & 书籍.mdk");
  const run = (args: string[], input?: string | Uint8Array) => {
    const result = spawnSync(process.execPath, [cli, ...args], {
      input,
      encoding: "utf8",
      timeout: 15000,
    });
    assert.ifError(result.error);
    return result;
  };
  const json = (args: string[], input?: string | Uint8Array) => {
    const result = run([...args, "--json"], input);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  const created = json(["new", file, "--mode", "book"]);
  for (const args of [["--help"], ["write", "--help"]])
    assert.match(run(args).stdout, /64 MiB.*256 MiB/);
  assert.equal(created.mode, "01");
  assert.equal(created.mode_name, "book");
  assert.equal(run(["new", file]).status, 1);
  assert.equal(fileRevision(file), created.revision);
  if (process.platform !== "win32") fs.chmodSync(file, 0o640);
  const first = created.entries[0].id;
  const markdown = "\ufeff# 开篇\r\n\r\n正文。\r\n";
  const gbk = json(
    ["write", file, first, "--if-revision", created.revision],
    Buffer.from([0xd6, 0xd0, 0xce, 0xc4]),
  );
  assert.equal(run(["read", file, first]).stdout, "中文");
  const written = json(
    ["write", file, first, "--if-revision", gbk.revision],
    markdown,
  );
  assert.equal(run(["read", file, first]).stdout, markdown.slice(1));
  assert.equal(json(["read", file, first]).revision, written.revision);
  const stale = run(
    ["write", file, first, "--if-revision", created.revision, "--json"],
    "过期",
  );
  assert.equal(stale.status, 3);
  assert.equal(JSON.parse(stale.stderr).code, "E_MDK_REVISION");
  assert.equal(fileRevision(file), written.revision);

  const added = json([
    "add",
    file,
    "第二章",
    "--title",
    "第二章：32:00:00",
    "--after",
    first,
    "--if-revision",
    written.revision,
  ]);
  const second = added.entries[1].id;
  assert.equal(added.entries[1].display_name, "第二章：32:00:00");
  const moved = json([
    "move",
    file,
    second,
    "inside",
    first,
    "--if-revision",
    added.revision,
  ]);
  assert.equal(moved.entries[1].position, "1.1");
  const batch = json(
    ["apply", file, "--if-revision", moved.revision],
    JSON.stringify({
      writes: [
        { id: first, markdown: "# 更新的开篇" },
        { id: second, markdown: "# 更新的第二章" },
      ],
      positions: [{ id: second, position: "2" }],
    }),
  );
  assert.equal(run(["read", file, second]).stdout, "# 更新的第二章");
  assert.equal(batch.entries[1].position, "2");
  const bad = run(
    ["apply", file, "--if-revision", batch.revision, "--json"],
    JSON.stringify({
      writes: [{ id: first, markdown: "不能写入" }],
      positions: [{ id: second, position: "1" }],
    }),
  );
  assert.equal(bad.status, 1);
  assert.equal(fileRevision(file), batch.revision);
  for (const malformed of [
    "{",
    JSON.stringify({ positions: [{ id: first, position: "banana" }] }),
  ]) {
    const invalid = run(
      ["apply", file, "--if-revision", batch.revision, "--json"],
      malformed,
    );
    assert.equal(invalid.status, 2);
    assert.equal(JSON.parse(invalid.stderr).code, "E_USAGE");
    assert.equal(fileRevision(file), batch.revision);
  }
  assert.equal(json(["validate", file]).valid, true);
  const binaryWrite = run(
    [
      "write-file",
      file,
      "resources/image/not-an-image.png",
      "--if-revision",
      batch.revision,
    ],
    "not an image",
  );
  assert.equal(binaryWrite.status, 1);
  assert.equal(fileRevision(file), batch.revision);

  const lock = file + ".mardikor-lock";
  fs.writeFileSync(lock, String(process.pid));
  const blocked = run(
    ["write", file, first, "--if-revision", batch.revision, "--json"],
    "不能写入",
  );
  assert.equal(blocked.status, 3);
  assert.equal(JSON.parse(blocked.stderr).code, "E_MDK_LOCKED");
  assert.equal(run(["unlock", file]).status, 3);
  assert.throws(
    () =>
      saveMdkSnapshot(file, {
        revision: batch.revision,
        text: { path: "markdown/001.md", content: "同一把锁" },
      }),
    { code: "E_MDK_LOCKED" },
  );
  assert.equal(fileRevision(file), batch.revision);
  fs.unlinkSync(lock);

  const compete = (content: string) =>
    new Promise<number | null>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [cli, "write", file, first, "--if-revision", batch.revision],
        {
          stdio: ["pipe", "ignore", "ignore"],
        },
      );
      child.once("error", reject);
      child.once("close", resolve);
      child.stdin.end(content);
    });
  assert.deepEqual(
    (await Promise.all([compete("甲"), compete("乙")])).sort(),
    [0, 3],
  );
  assert.match(run(["read", file, first]).stdout, /^[甲乙]$/);
  assert.equal(fs.existsSync(lock), false);
  fs.mkdirSync(lock);
  const owner = path.join(lock, randomUUID() + ".json");
  const ownerRecord = (pid: number) =>
    JSON.stringify({
      pid,
      host: os.hostname(),
      createdAt: new Date().toISOString(),
    });
  fs.writeFileSync(owner, ownerRecord(process.pid));
  assert.equal(run(["unlock", file]).status, 3);
  const departed = spawnSync(process.execPath, ["-e", ""]);
  assert.equal(departed.status, 0);
  fs.writeFileSync(owner, "\ufeff" + ownerRecord(departed.pid));
  assert.equal(json(["unlock", file]).unlocked, true);
  assert.equal(fs.existsSync(lock), false);
  fs.writeFileSync(lock, String(departed.pid) + "\r\n");
  assert.equal(json(["unlock", file]).unlocked, true);
  assert.equal(fs.existsSync(lock), false);
  fs.writeFileSync(lock, "unknown owner");
  assert.equal(run(["unlock", file]).status, 3);
  assert.equal(fs.readFileSync(lock, "utf8"), "unknown owner");
  fs.unlinkSync(lock);
  if (process.platform !== "win32")
    assert.equal(fs.statSync(file).mode & 0o777, 0o640);
  const additions = Array.from({ length: 446 }, (_, index) => ({
    id: "batch-" + index,
    path: `markdown/chapter/entry-${index}.md`,
    position: "3." + (index + 1),
    title: "片段 " + index + ":00",
    ...(index ? { markdown: `# 标题 ${index}\n\n正文。\n` } : {}),
  }));
  const bulk = json(
    ["apply", file, "--if-revision", fileRevision(file), "--quiet"],
    JSON.stringify({
      newEntries: additions,
      writes: [{ id: "batch-0", markdown: "同一批次的新文稿正文。" }],
      positions: [{ id: second, position: "2.1" }],
    }),
  );
  assert.deepEqual(Object.keys(bulk), ["revision"]);
  assert.equal(bulk.revision, fileRevision(file));
  const listed = json(["list", file]);
  assert.equal(listed.entries.length, 448);
  assert.equal(
    listed.entries.find(({ id }: { id: string }) => id === "batch-0")
      .display_name,
    "片段 0:00",
  );
  assert.equal(run(["read", file, "batch-0"]).stdout, "同一批次的新文稿正文。");
  const collision = run(
    ["apply", file, "--if-revision", bulk.revision],
    JSON.stringify({
      newEntries: [{ path: "markdown/001.md", position: "5" }],
      writes: [{ id: first, markdown: "不能覆盖" }],
    }),
  );
  assert.equal(collision.status, 1);
  assert.equal(fileRevision(file), bulk.revision);
  assert.equal(json(["validate", file]).valid, true);
});
