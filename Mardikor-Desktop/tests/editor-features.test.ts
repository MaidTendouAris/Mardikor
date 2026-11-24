import assert from "node:assert/strict";
import { test, after } from "node:test";
import fs from "node:fs";
import path from "node:path";
import {
  markdownHeadings,
  moveMarkdownSection,
  type SectionSide,
} from "../shared/markdown";
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
test("moves the original section text and keeps duplicate ordinals, containers, and front matter", () => {
  const prefix =
    "\ufeff---\ntitle: Guide\n# YAML comment\n---\n\nPreamble.\n\n# Manual\n\n";
  const installation =
    "## Review ###\n\nInstall.\n\n### Download\n\n```md\n# Example\n```\n\n> # Quote\n\n- ## List\n\n";
  const preparation =
    "Review\n------\n\nPrepare.\n\n### Environment\n\nA [link](<./path a>).\n\n";
  const suffix =
    "## FAQ\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n# Appendix\n\n## Different parent\n";
  for (const v2 of [false, true]) {
    const source = prefix + installation + preparation + suffix;
    const headings = markdownHeadings(source, v2);
    const [first, second] = headings.filter(({ title }) => title === "Review");
    const faq = headings.find(({ title }) => title === "FAQ")!;
    const environment = headings.find(({ title }) => title === "Environment")!;
    const download = headings.find(({ title }) => title === "Download")!;
    const other = headings.find(({ title }) => title === "Different parent")!;
    const move = (
      from: typeof first,
      target: typeof first,
      side: SectionSide,
    ) => moveMarkdownSection(source, headings, from, target, side, v2);
    assert(!headings.some(({ title }) => title === "Example"));
    assert(
      headings
        .filter(({ title }) =>
          ["YAML comment", "Quote", "List"].includes(title),
        )
        .every(({ section }) => section === undefined),
    );
    assert.equal(
      move(second, first, "before")?.content,
      prefix + preparation + installation + suffix,
    );
    assert.equal(move(second, first, "before")?.heading.line, first.line);
    assert.equal(
      move(first, second, "after")?.content,
      prefix + preparation + installation + suffix,
    );
    assert.equal(
      move(second, faq, "after")?.content,
      prefix +
        installation +
        suffix.split("# Appendix")[0] +
        preparation +
        "# Appendix" +
        suffix.split("# Appendix")[1],
    );
    assert.equal(move(first, first, "after"), undefined);
    assert.equal(move(first, second, "before"), undefined);
    assert.equal(move(first, download, "after"), undefined);
    assert.equal(move(download, environment, "before"), undefined);
    assert.equal(move(second, other, "before"), undefined);
  }
});

test("rotates the final line separator without changing CRLF, BOM or the missing final newline", () => {
  const first = "# Installation\r\n\r\nDownload this.\r\n\r\n";
  const second = "Preparation\r\n===========\r\n\r\nCheck this.";
  const source = "\ufeff" + first + second;
  const headings = markdownHeadings(source);
  const expected = "\ufeff" + second + "\r\n\r\n" + first.trimEnd();
  assert.equal(
    moveMarkdownSection(source, headings, headings[1], headings[0], "before")
      ?.content,
    expected,
  );
  assert.equal(
    moveMarkdownSection(source, headings, headings[0], headings[1], "after")
      ?.content,
    expected,
  );

  const adjacent = "# First\nContent\n# Second\nMore\nThird\n=====";
  // Put a Setext section where the preceding paragraph originally only needed one newline.
  const withSetext = adjacent.replace("More\nThird", "More\n\nThird");
  const rows = markdownHeadings(withSetext);
  assert.equal(
    moveMarkdownSection(withSetext, rows, rows[2], rows[1], "before")?.content,
    "# First\nContent\n\nThird\n=====\n\n# Second\nMore",
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
test("general insertion keeps opaque attachments inert and is atomic when a source cannot be read", () => {
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
  assert.throws(() =>
    mdk.insertMdkResources(
      file,
      [good, path.join(root, "missing-input")],
      insertion,
    ),
  );
  assert.deepEqual(fs.readFileSync(file), before);
  const result = mdk.insertMdkResources(
    file,
    [good, unsupported, prototypeName, forged, active],
    insertion,
  );
  assert.match(result.content, /!\[good\.png\]/);
  for (const source of [unsupported, prototypeName, forged, active]) {
    const name = path.basename(source);
    assert.ok(result.content.includes(`\n[${name}](`));
    assert.deepEqual(
      mdk.mdkAttachment(file, `resources/other/${name}`).getData(),
      fs.readFileSync(source),
    );
  }
  mdk.saveMdkTextFile(file, "markdown/001.md", "external change");
  const changed = fs.readFileSync(file);
  assert.throws(() => mdk.insertMdkResources(file, [good], insertion));
  assert.deepEqual(fs.readFileSync(file), changed);
});

test("automatic folder import applies the same allowlist and preserves source subfolders", () => {
  const file = path.join(root, "classified.mdk");
  const folder = path.join(root, "batch");
  fs.mkdirSync(path.join(folder, "nested"), { recursive: true });
  const expected = [
    ["cover.PNG", "image", png],
    [
      "nested/clip.mp4",
      "video",
      Buffer.from("000000186674797069736f6d00000000", "hex"),
    ],
    [
      "nested/track.m4a",
      "audio",
      Buffer.from("000000186674797069736f6d00000000", "hex"),
    ],
    ["nested/type.otf", "font", Buffer.from("OTTO font header")],
    ["nested/renamed.bin", "other", png],
    ["nested/forged.png", "other", Buffer.from("plain text")],
  ] as const;
  for (const [name, , bytes] of expected)
    fs.writeFileSync(path.join(folder, name), bytes);
  const project = mdk.createMdkProject(file, "00");
  mdk.importMdkResourceBatch(file, "resources", [folder], project.revision);
  for (const [name, kind, bytes] of expected)
    assert.deepEqual(
      mdk.mdkAttachment(file, `resources/${kind}/batch/${name}`).getData(),
      bytes,
    );
  assert.equal(
    mdk.readMdkTextFile(file, "markdown/001.md").content,
    "# 001\n\n",
  );
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
      texts: [...texts, { path: "contents.toml", content: "nodes = [1]" }],
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
