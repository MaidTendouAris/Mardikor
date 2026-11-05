import assert from "node:assert/strict";
import { test, after } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { markdownHeadings } from "../shared/markdown";
import { renderPreview } from "../src/services/preview";
import { defaultSettings } from "../shared/defaults";
import * as mdk from "../electron/mdk";
import { AppState } from "../electron/state";

const root = fs.mkdtempSync(path.resolve(".test-artifacts/editor-features-"));
after(() => {
  assert(root.startsWith(path.resolve(".test-artifacts") + path.sep));
  fs.rmSync(root, { recursive: true, force: true });
});
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1cAAAAASUVORK5CYII=",
  "base64",
);
test("heading outline follows Markdown semantics and nesting without including code examples", () => {
  const source =
    "# **开始**\n\n### 深层\n\n```md\n# 示例\n```\n\n## 小节\n\n末尾\n====\n";
  assert.deepEqual(
    markdownHeadings(source).map((h) => [h.title, h.level, h.depth, h.line]),
    [
      ["开始", 1, 0, 1],
      ["深层", 3, 1, 3],
      ["小节", 2, 1, 9],
      ["末尾", 1, 0, 11],
    ],
  );
  const settings = defaultSettings();
  settings.preview.show_title = false;
  assert.match(
    renderPreview("# 隐藏\n\n## 可见", settings),
    /id="mdk-heading-2"/,
  );
});
test("dropped resources and references commit together, use classified paths and avoid duplicate filenames", () => {
  const file = path.join(root, "drop.mdk"),
    image = path.join(root, "封面 #1.png"),
    pdf = path.join(root, "notes.pdf"),
    audio = path.join(root, "recording.wav"),
    video = path.join(root, "clip.mp4");
  fs.writeFileSync(image, png);
  fs.writeFileSync(pdf, "%PDF-1.7\nattachment");
  fs.writeFileSync(audio, "RIFF0000WAVEfmt ");
  fs.writeFileSync(
    video,
    Buffer.from("000000186674797069736f6d00000000", "hex"),
  );
  mdk.createMdkProject(file, "00");
  mdk.createTextFile(file, "markdown/part/正文.md", "# 正文\n\n");
  const marker = "MDKDROP012345678901234567890123456789";
  let project = mdk.openMdkProject(file);
  let result = mdk.insertMdkResources(file, [image, pdf, audio, video], {
    revision: project.revision,
    text: {
      path: "markdown/part/正文.md",
      content: "# 正文\n\n" + marker + "\n\n结束",
    },
    marker,
  });
  assert.equal(result.resources[0].kind, "image");
  assert.equal(result.resources[1].kind, "other");
  assert.equal(result.resources[2].path, "resources/audio/recording.wav");
  assert.equal(result.resources[3].path, "resources/video/clip.mp4");
  assert.match(
    result.content,
    /!\[封面 #1.png\]\(<\.\.\/\.\.\/resources\/image\/%E5/,
  );
  assert.match(
    result.content,
    /\[notes.pdf\]\(<\.\.\/\.\.\/resources\/other\/notes.pdf>\)/,
  );
  assert(mdk.validateMdk(file).valid);
  assert.equal(
    mdk.readMdkTextFile(file, "markdown/part/正文.md").content,
    result.content,
  );
  project = result.project;
  result = mdk.insertMdkResources(file, [image], {
    revision: project.revision,
    text: {
      path: "markdown/part/正文.md",
      content: result.content + "\n\n" + marker,
    },
    marker,
  });
  assert.match(result.resources[0].path, /-2\.png$/);
  assert(mdk.validateMdk(file).valid);
});
test("unsupported formats, forged signatures, active SVG and mixed batches leave the entire MDK unchanged", () => {
  const file = path.join(root, "reject.mdk"),
    good = path.join(root, "good.png"),
    unsupported = path.join(root, "tool.exe"),
    prototypeName = path.join(root, "tool.constructor"),
    forged = path.join(root, "forged.png"),
    active = path.join(root, "active.svg");
  fs.writeFileSync(good, png);
  fs.writeFileSync(unsupported, png);
  fs.writeFileSync(prototypeName, "not supported");
  fs.writeFileSync(forged, "not an image");
  fs.writeFileSync(
    active,
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
  );
  const project = mdk.createMdkProject(file, "00"),
    before = fs.readFileSync(file),
    marker = "MDKDROP012345678901234567890123456789";
  const insertion = {
    revision: project.revision,
    text: { path: "markdown/001.md", content: "# before\n\n" + marker },
    marker,
  };
  for (const sources of [
    [unsupported],
    [prototypeName],
    [forged],
    [active],
    [good, unsupported],
  ]) {
    assert.throws(() => mdk.insertMdkResources(file, sources, insertion));
    assert.deepEqual(fs.readFileSync(file), before);
  }
  mdk.saveMdkTextFile(file, "markdown/001.md", "external change");
  const changed = fs.readFileSync(file);
  assert.throws(() => mdk.insertMdkResources(file, [good], insertion));
  assert.deepEqual(fs.readFileSync(file), changed);
});

test("multi-editor snapshots save all files atomically and retain both recovery buffers", () => {
  const file = path.join(root, "groups.mdk");
  mdk.createMdkProject(file, "00");
  mdk.addMdkEntry(file, "second.md");
  const project = mdk.openMdkProject(file);
  const texts = [
    { path: "markdown/001.md", content: "# left\n\nleft change" },
    { path: "markdown/second.md", content: "# right\n\nright change" },
  ];
  const before = fs.readFileSync(file);
  assert.throws(() =>
    mdk.saveMdkSnapshot(file, {
      revision: project.revision,
      texts: [...texts, { path: "contents.toml", content: "schema_version=2" }],
    }),
  );
  assert.deepEqual(fs.readFileSync(file), before);
  assert.throws(() =>
    mdk.saveMdkSnapshot(file, {
      revision: project.revision,
      text: texts[0],
      texts,
    }),
  );
  assert.deepEqual(fs.readFileSync(file), before);
  const state = new AppState(path.join(root, "group-profile"));
  state.recovery(file, { revision: project.revision, texts });
  assert.deepEqual(state.recovery(file)?.texts, texts);
  assert.deepEqual(fs.readFileSync(file), before);
  const saved = mdk.saveMdkSnapshot(file, {
    revision: project.revision,
    texts,
  });
  for (const text of texts)
    assert.equal(mdk.readMdkTextFile(file, text.path).content, text.content);
  const good = fs.readFileSync(file);
  assert.throws(() =>
    mdk.saveMdkSnapshot(file, {
      revision: saved.revision,
      texts: [{ path: "settings.toml", content: "schema_version=1" }],
      settings: defaultSettings(),
    }),
  );
  assert.deepEqual(fs.readFileSync(file), good);
});
