import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
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
  const run = (args: string[], input?: string) => {
    const result = spawnSync(process.execPath, [cli, ...args], {
      input,
      encoding: "utf8",
      timeout: 15000,
    });
    assert.ifError(result.error);
    return result;
  };
  const json = (args: string[], input?: string) => {
    const result = run([...args, "--json"], input);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  const created = json(["new", file, "--mode", "book"]);
  assert.equal(created.mode, "01");
  assert.equal(run(["new", file]).status, 1);
  assert.equal(fileRevision(file), created.revision);
  if (process.platform !== "win32") fs.chmodSync(file, 0o640);
  const first = created.entries[0].id;
  const markdown = "\ufeff# 开篇\r\n\r\n正文。\r\n";
  const written = json(
    ["write", file, first, "--if-revision", created.revision],
    markdown,
  );
  assert.equal(run(["read", file, first]).stdout, markdown);
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
    "--after",
    first,
    "--if-revision",
    written.revision,
  ]);
  const second = added.entries[1].id;
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
  if (process.platform !== "win32")
    assert.equal(fs.statSync(file).mode & 0o777, 0o640);
});
