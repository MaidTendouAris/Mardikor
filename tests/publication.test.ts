import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import * as mdk from "../electron/mdk";
import { buildEpub, validateGeneratedEpub } from "../electron/epub";
import {
  configurePublication,
  publicationInfo,
  preparePublication,
  planPublication,
  exportPublication,
  type PublicationRuntime,
} from "../electron/publication";
import {
  inspectPublication,
  defaultPublication,
  bundledFontPath,
  bundledFontHash,
} from "../shared/publication";
import { parseToml, stringifyToml, type Table } from "../shared/schema";
import {
  pdfCjkAliases,
  restorePdfSourceCharacters,
} from "../electron/pdf-text";
import { PDFDocument, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { publicationHtml } from "../electron/publication-render";
import { publicationRasterSize } from "../electron/media";

const runtime: PublicationRuntime = {
  engine: "test-engine-1",
  assetDirectory: path.resolve("assets/export"),
  outputRevision: () => null,
  localConfiguration: () => null,
  verifyImages: () => {},
  verifyLayout: async () => {},
  pdf: async () => {
    throw new Error("Real PDF rendering is exercised by test:publication");
  },
  epub: buildEpub,
};
test("PDF text preserves the source Han character rather than an identical radical glyph", () => {
  const font = fs.readFileSync(
    path.resolve("assets/export/NotoSansCJKsc-Regular.otf"),
  );
  const aliases = pdfCjkAliases(font, "这里验证中文与页码");
  assert.equal(aliases.get(0x2eda), 0x9875);
  assert.equal(aliases.get(0x2fa5), 0x91cc);
  assert.throws(() => pdfCjkAliases(font, "页⻚"), /不同的源字符/);
});
test("PDF character repair changes only a font's ToUnicode map, never matching image data", async () => {
  const document = await PDFDocument.create(),
    context = document.context;
  const source =
    "begincmap\n/CMapType 2 def\n1 beginbfchar\n<01> <2EDA>\nendbfchar\nendcmap";
  const fontMap = context.register(context.flateStream(source));
  const image = context.register(
    context.flateStream(source, { Type: "XObject", Subtype: "Image" }),
  );
  context.register(
    context.obj({ Type: "Font", Subtype: "Type3", ToUnicode: fontMap }),
  );
  restorePdfSourceCharacters(document, new Map([[0x2eda, 0x9875]]));
  const decoded = (reference: typeof fontMap) => {
    const stream = context.lookup(reference);
    assert.ok(stream instanceof PDFRawStream);
    return Buffer.from(decodePDFRawStream(stream).decode()).toString();
  };
  assert.match(decoded(fontMap), /<01> <9875>/);
  assert.equal(decoded(image), source);
});
function fixture(mode = "01") {
  const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "mardikor-publication-"),
    ),
    file = path.join(directory, "作品.mdk");
  mdk.createMdkProject(file, mode);
  mdk.saveMdkTextFile(
    file,
    "markdown/001.md",
    "# 章节一\n\n正文与 **加粗**、`代码`。\n\n## 后文\n\n### 小节\n\n[标题链接](#后文)",
  );
  return { file, directory };
}
function configure(file: string) {
  const info = publicationInfo(file, runtime);
  return configurePublication(file, info.configuration, info.revision, runtime);
}
test("publication settings reject invalid dates, metadata, page ranges and unsafe templates", () => {
  for (const mutate of [
    (s: ReturnType<typeof defaultPublication>) => {
      s.metadata.modified = "2026-02-30T00:00:00Z";
    },
    (s: ReturnType<typeof defaultPublication>) => {
      s.metadata.language = "zh_CN";
    },
    (s: ReturnType<typeof defaultPublication>) => {
      s.pdf.page_ranges = "3-5,4";
    },
    (s: ReturnType<typeof defaultPublication>) => {
      s.pdf.header = "{unknown}";
    },
    (s: ReturnType<typeof defaultPublication>) => {
      s.pdf.page_height = Infinity;
    },
  ]) {
    const settings = defaultPublication("作品", "01");
    mutate(settings);
    assert.throws(() => inspectPublication(settings));
  }
});
test("raster size limits are enforced before native decoding", () => {
  assert.ok(
    publicationRasterSize(fs.readFileSync("assets/icon.png")).width > 0,
  );
  const png = fs.readFileSync("assets/icon.png"),
    animation = Buffer.alloc(20);
  animation.writeUInt32BE(8, 0);
  animation.write("acTL", 4);
  animation.writeUInt32BE(2, 8);
  assert.throws(
    () =>
      publicationRasterSize(
        Buffer.concat([png.subarray(0, 33), animation, png.subarray(33)]),
      ),
    /动画 PNG/,
  );
  const bomb = Buffer.alloc(24);
  Buffer.from("89504e470d0a1a0a", "hex").copy(bomb);
  bomb.writeUInt32BE(20000, 16);
  bomb.writeUInt32BE(20000, 20);
  assert.throws(() => publicationRasterSize(bomb), /四千万/);
  assert.throws(
    () => publicationRasterSize(Buffer.from("ffd8ffe00002ffda", "hex")),
    /尺寸/,
  );
});
test("plain header metadata cannot break out of the print stylesheet", () => {
  const { file } = fixture();
  const info = publicationInfo(file, runtime);
  info.configuration.publication.metadata.title =
    '</style><p id="spoof">injected</p>';
  info.configuration.publication.pdf.header = "{title}";
  configurePublication(file, info.configuration, info.revision, runtime);
  const html = publicationHtml(preparePublication(file, "pdf", runtime));
  assert.equal(html.includes('</style><p id="spoof">'), false);
  assert.ok(html.includes("\\3C /style\\3E "));
});
test("SVG validation rejects active elements hidden behind an XML namespace prefix", () => {
  const { file } = fixture();
  configure(file);
  mdk.createTextFile(
    file,
    "resources/image/prefixed.svg",
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:s="http://www.w3.org/2000/svg"><s:script>alert(1)</s:script></svg>',
  );
  mdk.saveMdkTextFile(
    file,
    "markdown/001.md",
    "# 标题\n\n![图片](../resources/image/prefixed.svg)",
  );
  assert.ok(
    preparePublication(file, "epub", runtime).issues.some(
      (issue) => issue.code === "E_CONVERSION_RESOURCE",
    ),
  );
});
test("portable settings pin the bundled font without copying it and retain unknown TOML", () => {
  const { file } = fixture();
  const value = parseToml(mdk.readMdkTextFile(file, "settings.toml").content);
  value.vendor = { keep: "untouched" };
  (value.appearance as Table).vendor_integer = 9007199254740993n;
  value.extensions = { other_vendor: { exact: 9007199254740993n } };
  mdk.saveMdkTextFile(file, "settings.toml", stringifyToml(value));
  const info = configure(file);
  assert.equal(info.configuration.appearance.font_family, "system");
  assert.equal(info.configuration.publication.pdf.font_sha256, bundledFontHash);
  assert.equal(info.configuration.publication.pdf.engine, runtime.engine);
  assert.ok(
    info.configuration.publication.metadata.identifier.startsWith("urn:uuid:"),
  );
  const saved = parseToml(mdk.readMdkTextFile(file, "settings.toml").content);
  assert.equal((saved.vendor as Table).keep, "untouched");
  assert.equal((saved.appearance as Table).vendor_integer, 9007199254740993n);
  assert.ok(
    !mdk
      .openMdkProject(file)
      .files.some((item) => item.path === bundledFontPath),
  );
  assert.ok(fs.statSync(file).size < 100_000);
  assert.equal(
    preparePublication(file, "pdf", runtime).issues.filter(
      (issue) => issue.severity === "error",
    ).length,
    0,
  );
  assert.equal(
    ((saved.extensions as Table).other_vendor as Table).exact,
    9007199254740993n,
  );
  assert.equal(mdk.validateMdk(file).valid, true);
  const settings = mdk.openMdkProject(file).settings;
  settings.colors.text = "#123456";
  mdk.updateMdkSettings(file, settings);
  assert.equal(
    publicationInfo(file, runtime).configuration.publication.pdf.font_sha256,
    bundledFontHash,
  );
});
test("PDF and EPUB render inline and aligned block math and reject invalid formulas", async () => {
  const { file } = fixture();
  mdk.saveMdkTextFile(
    file,
    "markdown/001.md",
    "# 公式\n\n能量 $E=mc^2$，字面量 `$a+b$`。\n\n$$\n\\begin{aligned}a&=\\frac{1}{2}\\\\b&=\\sqrt{2}\\end{aligned}\n$$\n\n$x=\\text{物理常数}$",
  );
  configure(file);
  const pdf = preparePublication(file, "pdf", runtime);
  assert.deepEqual(
    pdf.issues.filter((issue) => issue.severity === "error"),
    [],
  );
  assert.match(publicationHtml(pdf), /math\/katex.min.css/);
  assert.match(pdf.chapters[0].html, /class="katex-html"/);
  assert.match(pdf.fontText, /物理常数/);
  assert.doesNotMatch(pdf.chapters[0].html, /\$E=mc\^2\$/);
  const epub = await buildEpub(preparePublication(file, "epub", runtime));
  const zip = new AdmZip(epub);
  assert.match(zip.readAsText("EPUB/package.opf"), /properties="mathml"/);
  const chapter = zip.readAsText("EPUB/chapter-0001.xhtml");
  assert.match(chapter, /<msup>/);
  assert.match(chapter, /display="block"[\s\S]*<mtable/);
  assert.match(chapter, /<code>\$a\+b\$<\/code>/);
  mdk.saveMdkTextFile(file, "markdown/001.md", "$\\unknownMacro$");
  for (const format of ["pdf", "epub"] as const) {
    const result = await planPublication(file, format, runtime);
    assert.ok(
      result.report.issues.some(
        ({ code, path }) => code === "E_MATH" && path === "markdown/001.md",
      ),
    );
    assert.equal(result.report.valid, false);
  }
});
test("book EPUB is deterministic, preserves heading links and escapes XML metadata", async () => {
  const { file } = fixture();
  const info = publicationInfo(file, runtime);
  info.configuration.publication.metadata.title = '书名 & <标题> "引用"';
  configurePublication(file, info.configuration, info.revision, runtime);
  const prepared = preparePublication(file, "epub", runtime);
  assert.deepEqual(
    prepared.issues.filter((i) => i.severity === "error"),
    [],
  );
  const epub = await buildEpub(prepared);
  assert.ok(epub.equals(await buildEpub(prepared)));
  validateGeneratedEpub(epub);
  const zip = new AdmZip(epub),
    chapter = zip.readAsText("EPUB/chapter-0001.xhtml");
  assert.match(chapter, /href="chapter-0001.xhtml#heading-2"/);
  assert.match(
    zip.readAsText("EPUB/nav.xhtml"),
    /1\.1 后文<\/a><ol><li><a href="chapter-0001.xhtml#heading-3">1\.1\.1 小节/,
  );
  assert.match(
    zip.readAsText("EPUB/package.opf"),
    /书名 &amp; &lt;标题&gt; &quot;引用&quot;/,
  );
  const subset = zip.getEntry("EPUB/assets/body-font.otf")!.getData();
  assert.ok(subset.length < prepared.font.length / 4);
  assert.ok(zip.getEntry("META-INF/font-license.txt"));
});
test("mode and strict conversion preflight reject unsupported or lossy content", async () => {
  const { file } = fixture("00");
  configure(file);
  assert.equal(
    (await planPublication(file, "epub", runtime)).report.valid,
    false,
  );
  mdk.setMdkMode(file, "01");
  for (const [markdown, code] of [
    ["# 标题\n\n[坏锚点](#不存在)", "E_ANCHOR_MISSING"],
    ["# 标题\n\n![图](https://example.com/x.png)", "E_REMOTE_MEDIA"],
    ["# 标题\n\n[附件](../resources/other/a.pdf)", "E_LINK_NOT_EXPORTED"],
    ["# 标题\n\n[危险](javascript:alert(1))", "E_CONVERSION_URL"],
  ]) {
    mdk.saveMdkTextFile(file, "markdown/001.md", markdown);
    assert.ok(
      preparePublication(file, "epub", runtime).issues.some(
        (i) => i.code === code,
      ),
      code,
    );
  }
});
test("EPUB-only configuration embeds emoji subsets and escapes raw HTML without copying the body font into MDK", async () => {
  const { file } = fixture();
  mdk.saveMdkTextFile(
    file,
    "markdown/001.md",
    "# 中文 😀🚀👍\n\n<kbd>按键</kbd>",
  );
  const info = publicationInfo(file, runtime);
  configurePublication(
    file,
    info.configuration,
    info.revision,
    runtime,
    "epub",
  );
  assert.ok(fs.statSync(file).size < 200_000);
  const prepared = preparePublication(file, "epub", runtime);
  assert.equal(
    prepared.issues.some((i) => i.severity === "error"),
    false,
  );
  assert.ok(prepared.issues.some((i) => i.code === "W_EPUB_HTML_TEXT"));
  const zip = new AdmZip(await buildEpub(prepared));
  assert.match(zip.readAsText("EPUB/chapter-0001.xhtml"), /&lt;kbd&gt;/);
  assert.ok(zip.getEntry("EPUB/assets/NotoEmoji.ttf"));
  assert.ok(zip.getEntry("META-INF/emoji-font-license.txt"));
});
test("virtual hierarchy, repeated documents, comic spreads and RTL remain distinct", async () => {
  const { file } = fixture("02");
  const contents = parseToml(
    mdk.readMdkTextFile(file, "contents.toml").content,
  );
  const entry = (
    contents.entries as { id: string; path: string; position: string }[]
  )[0];
  contents.entries = [
    { ...entry, position: "2.1" },
    { ...entry, id: "duplicate", position: "2.2" },
    { ...entry, id: "odd", position: "3" },
  ];
  mdk.saveMdkTextFile(file, "contents.toml", stringifyToml(contents));
  const info = publicationInfo(file, runtime);
  info.configuration.comic.spread_mode = "double";
  info.configuration.comic.reading_direction = "rtl";
  configurePublication(file, info.configuration, info.revision, runtime);
  const prepared = preparePublication(file, "epub", runtime),
    zip = new AdmZip(await buildEpub(prepared));
  assert.equal(prepared.chapters.length, 3);
  assert.match(zip.readAsText("EPUB/nav.xhtml"), /分组 2/);
  const opf = zip.readAsText("EPUB/package.opf");
  assert.match(opf, /page-progression-direction="rtl"/);
  assert.match(opf, /idref="chapter-0" properties="page-spread-right"/);
  assert.match(opf, /idref="chapter-1" properties="page-spread-left"/);
  assert.match(
    opf,
    /idref="chapter-2" properties="rendition:page-spread-center"/,
  );
});
test("strict export rejects engine drift and stale preflight without publishing a file", async () => {
  const { file, directory } = fixture();
  configure(file);
  assert.ok(
    preparePublication(file, "pdf", {
      ...runtime,
      engine: "different-engine",
    }).issues.some((i) => i.code === "E_PDF_ENGINE"),
  );
  const plan = await planPublication(file, "epub", runtime);
  mdk.saveMdkTextFile(file, "markdown/001.md", "# 正文已改变");
  const output = path.join(directory, "never.epub");
  await assert.rejects(
    exportPublication(file, output, "epub", plan.fingerprint, runtime),
    /预检后已变化/,
  );
  assert.equal(fs.existsSync(output), false);
});
test("generated EPUB validation catches broken generated references and malformed XHTML", async () => {
  const { file } = fixture();
  configure(file);
  const epub = await buildEpub(preparePublication(file, "epub", runtime));
  const broken = new AdmZip(epub, { noSort: true });
  broken.updateFile(
    "EPUB/chapter-0001.xhtml",
    Buffer.from(
      broken
        .readAsText("EPUB/chapter-0001.xhtml")
        .replace("#heading-2", "#missing"),
    ),
  );
  assert.throws(() => validateGeneratedEpub(broken.toBuffer()), /锚点/);
  const malformed = new AdmZip(epub, { noSort: true });
  malformed.updateFile(
    "EPUB/chapter-0001.xhtml",
    Buffer.from("<html><p>broken</html>"),
  );
  assert.throws(() => validateGeneratedEpub(malformed.toBuffer()));
});
