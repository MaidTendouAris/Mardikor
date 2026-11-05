import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createMarkdownFile,
  openMarkdownFile,
  readMarkdownFile,
  saveMarkdownSnapshot,
  insertMarkdownResources,
  readMarkdownResource,
} from "../electron/markdown-file";
import { AppState } from "../electron/state";
import { isManuscript, isSupportedDocument } from "../shared/workspace";

function fixture(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mardikor-md-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "单文稿.MD");
  return { root, file };
}
test("single Markdown is a UTF-8 file, preserves source bytes and never creates MDK control files", (t) => {
  const { root, file } = fixture(t);
  createMarkdownFile(file);
  const original =
    "\ufeff# 标题\r\n\r\n[引用][id]\r\n\r\n[id]: https://example.com\r\n";
  fs.writeFileSync(file, original);
  const before = fs.readFileSync(file),
    project = openMarkdownFile(file);
  assert.equal(project.format, "markdown");
  assert.equal(project.settings_readonly, true);
  assert(isManuscript(project, path.basename(file)));
  assert(isSupportedDocument(file));
  assert.equal(readMarkdownFile(file, path.basename(file)).content, original);
  assert.deepEqual(fs.readFileSync(file), before);
  saveMarkdownSnapshot(file, {
    revision: project.revision,
    texts: [{ path: path.basename(file), content: original + "追加\r\n" }],
  });
  assert.equal(fs.readFileSync(file, "utf8"), original + "追加\r\n");
  assert.deepEqual(fs.readdirSync(root), [path.basename(file)]);
  assert.throws(() => createMarkdownFile(file));
  assert.throws(() => createMarkdownFile(path.join(root, "bad.mdk")));
});
test("single Markdown rejects control-file writes, invalid text and stale snapshots without changing the document", (t) => {
  const { file } = fixture(t);
  const project = createMarkdownFile(file);
  assert.throws(() => readMarkdownFile(file, "settings.toml"));
  for (const snapshot of [
    { revision: project.revision, settings: project.settings },
    { revision: project.revision, positions: [] },
    {
      revision: project.revision,
      text: { path: "settings.toml", content: "bad" },
    },
    {
      revision: project.revision,
      text: { path: path.basename(file), content: "bad\0" },
    },
  ])
    assert.throws(() => saveMarkdownSnapshot(file, snapshot));
  assert.equal(fs.readFileSync(file, "utf8"), "");
  fs.writeFileSync(file, "外部修改");
  assert.throws(
    () =>
      saveMarkdownSnapshot(file, {
        revision: project.revision,
        text: { path: path.basename(file), content: "覆盖" },
      }),
    /其他进程/,
  );
  assert.equal(fs.readFileSync(file, "utf8"), "外部修改");
  fs.writeFileSync(file, Buffer.from([0xff, 0xfe, 0x00]));
  assert.throws(() => openMarkdownFile(file));
});
test("standalone image insertion uses sibling resources, safe relative URLs and duplicate-name handling", (t) => {
  const { root, file } = fixture(t);
  let project = createMarkdownFile(file);
  const source = path.join(root, "图 [1].png");
  fs.copyFileSync(path.resolve("assets/icon.png"), source);
  const insert = () =>
    insertMarkdownResources(file, [source], {
      revision: project.revision,
      text: {
        path: path.basename(file),
        content: "# 标题\n\nMDKINSERT12345678901234567890",
      },
      marker: "MDKINSERT12345678901234567890",
    });
  const first = insert();
  assert.match(first.content, /resources\/image\/.*%20%5B1%5D/);
  assert(fs.existsSync(path.join(root, "resources/image/图 [1].png")));
  assert.equal(first.project.files.length, 2);
  assert.match(
    readMarkdownResource(file, first.resources[0].path),
    /^data:image\/png;base64,/,
  );
  project = first.project;
  const second = insert();
  assert.equal(second.resources[0].path, "resources/image/图 [1]-2.png");
  assert.throws(() => readMarkdownResource(file, "../图 [1].png"));
  assert(!fs.existsSync(path.join(root, "settings.toml")));
});
test("standalone rejected batches and failed body saves leave resources and document unchanged", (t) => {
  const { root, file } = fixture(t),
    project = createMarkdownFile(file);
  const source = path.join(root, "image.png"),
    bad = path.join(root, "bad.exe");
  fs.copyFileSync(path.resolve("assets/icon.png"), source);
  fs.writeFileSync(bad, "not supported");
  const insertion = {
    revision: project.revision,
    text: {
      path: path.basename(file),
      content: "MDKINSERT12345678901234567890",
    },
    marker: "MDKINSERT12345678901234567890",
  };
  assert.throws(
    () => insertMarkdownResources(file, [source, bad], insertion),
    /不支持/,
  );
  assert.throws(() =>
    insertMarkdownResources(file, [source], {
      ...insertion,
      text: { ...insertion.text, content: insertion.text.content + "\0" },
    }),
  );
  assert.equal(fs.readFileSync(file, "utf8"), "");
  assert(!fs.existsSync(path.join(root, "resources")));
});
test("Markdown recent entries and recovery remain separate from the document", (t) => {
  const { root, file } = fixture(t),
    project = createMarkdownFile(file);
  const state = new AppState(path.join(root, "profile"));
  state.remember(file, "markdown");
  state.recovery(file, {
    revision: project.revision,
    texts: [{ path: path.basename(file), content: "恢复内容" }],
  });
  assert.equal(state.recent()[0].title, "单文稿");
  assert.equal(state.recent()[0].mode, "markdown");
  assert.equal(state.recovery(file)?.texts?.[0].content, "恢复内容");
  assert.equal(fs.readFileSync(file, "utf8"), "");
});
