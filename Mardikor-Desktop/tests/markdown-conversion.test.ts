import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { pathToFileURL } from "node:url";
import { convertMarkdownToMdk } from "../electron/markdown-conversion";
import {
  openMdkProject,
  readMdkResource,
  readMdkTextFile,
  validateMdk,
} from "../electron/mdk";

function fixture(t: TestContext) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "mardikor-convert-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const source = path.join(base, "wiki", "主页.md");
  const output = path.join(base, "wiki.mdk");
  const originals = new Map<string, Buffer>();
  function write(relative: string, data: string | Buffer) {
    const file = path.join(base, relative);
    const bytes = typeof data === "string" ? Buffer.from(data) : data;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
    originals.set(file, bytes);
    return file;
  }
  return { base, source, output, originals, write };
}

test("Markdown conversion recursively packages local documents and resources with resolved links", (t) => {
  const { source, output, originals, write } = fixture(t);
  const png = fs.readFileSync("assets/icon.png");
  const media = write("assets/图 #1.png", png);
  const chapter = write(
    "wiki/一/Guide.MD",
    [
      "# Chapter",
      "",
      "[回首页](../主页.md#首页)",
      "[同名文件](../../other/guide.md)",
      "",
      "> ![图][p]",
      ">",
      "> [p]:",
      '>   <../../assets/图 %231.png> "标题"',
      "",
      "## More **Details**",
      "",
      "## More **Details**",
      "",
      "[本篇](Guide.MD#more-details-1)",
      "",
    ].join("\n"),
  );
  write("other/guide.md", "[回到第一份](../wiki/一/Guide.MD)\n");
  const attachment = write("docs/design.pdf", "%PDF-1.7\nAttachment\n");
  write(
    "wiki/主页.md",
    [
      "\ufeff# 首页",
      "",
      "[开始阅读](<一/Guide.MD#more-details> '保留标题')",
      "[同一文件][chapter] [chapter][] [chapter]",
      "[附件](<" + pathToFileURL(attachment).href + ">)",
      "[网页](https://example.org/a.md)",
      "",
      "> [chapter]:",
      ">   " + pathToFileURL(chapter).href,
      "",
      "[chapter]: ignored.md",
      "[unused]: never-imported.md",
      "",
      "| 资源 | 附件 |",
      "| --- | --- |",
      "| ![图](<../assets/图 %231.png>) | [附](../docs/design.pdf) |",
      "",
      "示例 \x60[代码](fake-inline.md)\x60。",
      "",
      "\x60\x60\x60md",
      "![代码](fake.png)",
      "\x60\x60\x60",
      "",
      "<!-- [注释](fake-comment.md) -->",
      "",
    ].join("\r\n"),
  );

  convertMarkdownToMdk(source, output);
  const project = openMdkProject(output);
  const entries = project.contents.entries;
  assert.equal(project.mode, "00");
  assert.deepEqual(
    entries.map(({ path }) => path),
    [
      "markdown/conversion-report.md",
      "markdown/主页.md",
      "markdown/Guide.md",
      "markdown/guide-2.md",
    ],
  );
  const report = readMdkTextFile(output, entries[0].path).content;
  assert.match(report, /已收录 3 篇源文稿和 2 个附件/);
  assert.match(report, /没有发现需要记录的引用问题/);
  assert.doesNotMatch(report, /fake|never-imported|ignored/);
  const home = readMdkTextFile(output, entries[1].path).content;
  assert(home.startsWith("\ufeff# 首页\r\n"));
  assert(home.includes("[开始阅读](<Guide.md#h-more-details> '保留标题')"));
  assert(home.includes(">   <Guide.md>\r\n"));
  assert(home.includes("[附件](<../resources/other/design.pdf>)"));
  assert(home.includes("![图](<../resources/image/%E5%9B%BE%20%231.png>)"));
  assert(home.includes("[网页](https://example.org/a.md)"));
  assert(home.includes("\x60[代码](fake-inline.md)\x60"));
  assert(home.includes("![代码](fake.png)"));
  const imported = readMdkTextFile(output, entries[2].path).content;
  assert(imported.includes("[本篇](<#h-more-details-2>)"));
  assert(
    imported.includes("[回首页](<%E4%B8%BB%E9%A1%B5.md#h-%E9%A6%96%E9%A1%B5>)"),
  );
  assert(imported.includes('<../resources/image/%E5%9B%BE%20%231.png> "标题"'));
  assert.equal(
    readMdkResource(output, "resources/image/图 #1.png"),
    "data:image/png;base64," + png.toString("base64"),
  );
  const validation = validateMdk(output);
  assert.equal(validation.valid, true, JSON.stringify(validation.issues));
  for (const [file, before] of originals)
    assert.deepEqual(fs.readFileSync(file), before);
  assert(fs.existsSync(media));
});

test("conversion records unavailable references and publishes atomically without overwriting", (t) => {
  const { base, source, output, originals, write } = fixture(t);
  fs.mkdirSync(path.join(base, "wiki", "folder"), { recursive: true });
  write(
    "wiki/legado.markdown",
    Buffer.from([0x23, 0x20, 0xd6, 0xd0, 0xce, 0xc4, 0x0a]),
  );
  write(
    "wiki/主页.md",
    [
      "# Home",
      "",
      "[无文件](missing.md) ![原图说明][missing]",
      "[目录](folder) [其他协议](javascript:some-text) [坏编码](file%FF.md)",
      "[目标](legado.markdown?show=1#no-such-heading)",
      "",
      "[missing]: no-photo.png",
      "",
    ].join("\n"),
  );
  convertMarkdownToMdk(source, output);
  const report = readMdkTextFile(
    output,
    "markdown/conversion-report.md",
  ).content;
  for (const item of [
    "missing.md",
    "no-photo.png",
    "folder",
    "javascript:some-text",
    "file%FF.md",
    "no-such-heading",
  ])
    assert(report.includes(item), report);
  const result = readMdkTextFile(output, "markdown/主页.md").content;
  assert(result.includes("无文件 原图说明"));
  assert(result.includes("目录 其他协议 坏编码"));
  assert(result.includes("[目标](<legado.md>)"));
  assert.equal(
    readMdkTextFile(output, "markdown/legado.md").content,
    "# 中文\n",
  );
  const validation = validateMdk(output);
  assert.equal(validation.valid, true, JSON.stringify(validation.issues));
  const saved = fs.readFileSync(output);
  assert.throws(() => convertMarkdownToMdk(source, output), /已存在/);
  assert.throws(
    () =>
      convertMarkdownToMdk(
        path.join(base, "missing.md"),
        path.join(base, "bad.mdk"),
      ),
    /不存在/,
  );
  assert(!fs.existsSync(path.join(base, "bad.mdk")));
  assert.deepEqual(fs.readFileSync(output), saved);
  for (const [file, before] of originals)
    assert.deepEqual(fs.readFileSync(file), before);
});
