import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import * as mdk from "../electron/mdk";
import { buildEpub, validateGeneratedEpub } from "../electron/epub";
import {
  publicationInfo,
  preparePublication,
  planPublication,
  exportPublication,
  type PublicationRuntime,
} from "../electron/publication";
import { inspectPublication, defaultPublication } from "../shared/publication";
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
  const manifest = parseToml(mdk.readMdkTextFile(file, "mdk.toml").content);
  manifest.metadata = {
    title: "作品",
    language: "zh-CN",
    identifier: "urn:uuid:51d7c39d-09e2-460e-a94a-587b18f5c2a6",
  };
  mdk.saveMdkTextFile(file, "mdk.toml", stringifyToml(manifest));
  const presets = [
    { id: "print", format: "pdf", pdf: { layout: "flow" } },
    {
      id: "read",
      format: "epub",
      epub: { layout: "reflowable", embed_font: true },
    },
  ];
  mdk.saveMdkTextFile(file, "publication.toml", stringifyToml({ presets }));
  mdk.saveMdkTextFile(
    file,
    "markdown/001.md",
    "# 章节一\n\n正文与 **加粗**、`代码`。\n\n## 后文\n\n### 小节\n\n[标题链接](#h-后文)",
  );
  return { file, directory };
}
function changeControl(
  file: string,
  name: string,
  edit: (value: Table) => void,
) {
  const value = parseToml(mdk.readMdkTextFile(file, name).content);
  edit(value);
  mdk.saveMdkTextFile(file, name, stringifyToml(value));
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
test("plain metadata cannot break out of publication markup", () => {
  const { file } = fixture();
  changeControl(file, "mdk.toml", (value) => {
    (value.metadata as Table).title = '</style><p id="spoof">injected</p>';
  });
  const html = publicationHtml(preparePublication(file, "pdf", runtime));
  assert.equal(html.includes('</style><p id="spoof">'), false);
  assert.ok(html.includes("&lt;/style&gt;"));
});
test("SVG validation rejects active elements hidden behind an XML namespace prefix", () => {
  const { file } = fixture();
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
test("v2 PDF uses the bundled font without copying it and ordinary settings edits retain unknown TOML", () => {
  const { file } = fixture();
  const value: Table = {};
  value.vendor = { keep: "untouched" };
  value.body = { vendor_integer: 9007199254740993n };
  value.extensions = { other_vendor: { exact: 9007199254740993n } };
  mdk.saveMdkTextFile(file, "settings.toml", stringifyToml(value));
  assert.deepEqual(
    publicationInfo(file, runtime).presets?.map(({ id }) => id),
    ["print", "read"],
  );
  const saved = parseToml(mdk.readMdkTextFile(file, "settings.toml").content);
  assert.equal((saved.vendor as Table).keep, "untouched");
  assert.equal((saved.body as Table).vendor_integer, 9007199254740993n);
  assert.ok(
    !mdk
      .openMdkProject(file)
      .files.some(
        (item) =>
          item.path.startsWith("resources/font/") && item.kind !== "directory",
      ),
  );
  assert.ok(fs.statSync(file).size < 100_000);
  assert.equal(
    ((saved.extensions as Table).other_vendor as Table).exact,
    9007199254740993n,
  );
  const settings = mdk.openMdkProject(file).settings;
  settings.colors.text = "#123456";
  mdk.updateMdkSettings(file, settings);
  assert.equal(
    (
      parseToml(mdk.readMdkTextFile(file, "settings.toml").content)
        .body as Table
    ).vendor_integer,
    9007199254740993n,
  );
  const clean = fixture();
  assert.deepEqual(
    preparePublication(clean.file, "pdf", runtime).issues.filter(
      ({ severity }) => severity === "error",
    ),
    [],
  );
  assert.equal(
    preparePublication(clean.file, "pdf", runtime).font.length,
    fs.statSync("assets/export/NotoSansCJKsc-Regular.otf").size,
  );
});
test("unregistered math stays literal in v2 PDF and EPUB", async () => {
  const { file } = fixture();
  mdk.saveMdkTextFile(
    file,
    "markdown/001.md",
    "# 公式\n\n能量 $E=mc^2$，字面量 `$a+b$`。\n\n$$\n\\begin{aligned}a&=\\frac{1}{2}\\\\b&=\\sqrt{2}\\end{aligned}\n$$\n\n$x=\\text{物理常数}$",
  );
  const pdf = preparePublication(file, "pdf", runtime);
  assert.deepEqual(
    pdf.issues.filter((issue) => issue.severity === "error"),
    [],
  );
  assert.doesNotMatch(publicationHtml(pdf), /math\/katex.min.css/);
  assert.match(pdf.chapters[0].html, /\$E=mc\^2\$/);
  const epub = await buildEpub(preparePublication(file, "epub", runtime));
  const zip = new AdmZip(epub);
  assert.doesNotMatch(
    zip.readAsText("EPUB/package.opf"),
    /properties="mathml"/,
  );
  const chapter = zip.readAsText("EPUB/chapter-0001.xhtml");
  assert.match(chapter, /<code[^>]*>\$a\+b\$<\/code>/);
  mdk.saveMdkTextFile(file, "markdown/001.md", "$\\unknownMacro$");
  for (const format of ["pdf", "epub"] as const) {
    const result = await planPublication(file, format, runtime);
    assert.equal(result.report.valid, true);
  }
});
test("book EPUB preserves heading links and escapes XML metadata", async () => {
  const { file } = fixture();
  changeControl(file, "mdk.toml", (value) => {
    (value.metadata as Table).title = '书名 & <标题> "引用"';
  });
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
  assert.match(chapter, /href="chapter-0001.xhtml#h-后文"/);
  assert.match(zip.readAsText("EPUB/nav.xhtml"), /chapter-0001.xhtml/);
  assert.match(
    zip.readAsText("EPUB/package.opf"),
    /书名 &amp; &lt;标题&gt; &quot;引用&quot;/,
  );
  const subset = zip.getEntry("EPUB/assets/body-font.otf")!.getData();
  assert.ok(subset.length < prepared.font.length / 4);
  assert.ok(zip.getEntry("META-INF/font-license.txt"));
});
test("default can publish EPUB and strict preflight rejects unresolved active dependencies", async () => {
  const { file } = fixture("00");
  assert.equal(
    (await planPublication(file, "epub", runtime)).report.valid,
    true,
  );
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
test("explicit groups, repeated documents, comic spreads and RTL remain distinct", async () => {
  const { file } = fixture("02");
  const contents = parseToml(
    mdk.readMdkTextFile(file, "contents.toml").content,
  );
  const entry = (contents.nodes as Table[])[0];
  contents.nodes = [
    { id: "part", kind: "group", title: "分组 2", order: 1n },
    { ...entry, parent: "part", order: 1n },
    { ...entry, id: "duplicate", parent: "part", order: 2n },
    { ...entry, id: "odd", order: 2n },
  ];
  mdk.saveMdkTextFile(file, "contents.toml", stringifyToml(contents));
  changeControl(file, "publication.toml", (value) => {
    const epub = (value.presets as Table[]).find(({ id }) => id === "read")!
      .epub as Table;
    Object.assign(epub, {
      layout: "fixed",
      direction: "rtl",
      spread: "double",
    });
  });
  const prepared = preparePublication(file, "epub", runtime),
    zip = new AdmZip(await buildEpub(prepared));
  assert.equal(prepared.chapters.length, 3);
  assert.match(zip.readAsText("EPUB/nav.xhtml"), /分组 2/);
  const opf = zip.readAsText("EPUB/package.opf");
  assert.match(opf, /page-progression-direction="rtl"/);
  assert.match(opf, /idref="chapter-0" properties="page-spread-right"/);
  assert.match(opf, /idref="chapter-1" properties="page-spread-left"/);
  assert.match(opf, /idref="chapter-2" properties="page-spread-right"/);
});
test("strict export rejects stale preflight without publishing a file", async () => {
  const { file, directory } = fixture();
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
  const epub = await buildEpub(preparePublication(file, "epub", runtime));
  const broken = new AdmZip(epub, { noSort: true });
  broken.updateFile(
    "EPUB/chapter-0001.xhtml",
    Buffer.from(
      broken
        .readAsText("EPUB/chapter-0001.xhtml")
        .replace("#h-后文", "#missing"),
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
