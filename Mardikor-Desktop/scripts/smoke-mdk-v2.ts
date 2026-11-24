import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { _electron as electron, expect } from "@playwright/test";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFStream } from "pdf-lib";
import AdmZip from "adm-zip";
import {
  MDK_MIMETYPE,
  createMdkProject,
  createTextFile,
  packMdk,
  readMdkTextFile,
  saveMdkTextFile,
} from "../electron/mdk";
import { addArchiveMember } from "../electron/archive";
import { AppState } from "../electron/state";
import { validateGeneratedEpub } from "../electron/epub";

const root = path.resolve(".test-artifacts/v2-electron");
await fs.mkdir(root, { recursive: true });
const run = await fs.mkdtemp(path.join(root, "run-"));
const file = path.join(run, "book.mdk");
const comic = path.join(run, "comic.mdk");
const minimal = path.join(run, "minimal.mdk");
const defaultProject = path.join(run, "default.mdk");
const missing = path.join(run, "missing.mdk");
const readonly = path.join(run, "readonly.mdk");
const compressed = path.join(run, "old-compressed.mdk");
const tableProject = path.join(run, "tables.mdk");
const fontProject = path.join(run, "fonts.mdk");
const sampleFont = path.resolve("assets/export/NotoSerifCJKsc-Regular.otf");
const packedFont = "resources/font/NotoSerifCJKsc-Regular.otf";
const profile = path.join(run, "profile");
packMdk("docs/examples/v2/book", file);
packMdk("docs/examples/v2/comic", comic);
packMdk("docs/examples/v2/minimal", minimal);
createMdkProject(defaultProject, "00");
createMdkProject(fontProject, "00");
createTextFile(fontProject, "settings.toml", '[body]\nfont = "resources/font/Missing.otf"\n');
saveMdkTextFile(fontProject, "mdk.toml", readMdkTextFile(fontProject, "mdk.toml").content +
  '\n[metadata]\ntitle = "Font sample"\nlanguage = "en"\nidentifier = "urn:mardikor:font-smoke"\n');
createMdkProject(tableProject, "00");
const columns = Array.from({ length: 44 }, (_, index) => String(index + 1));
const wideTable = [
  columns,
  columns.map(() => "---"),
  columns.map(() => "X"),
].map((row) => `| ${row.join(" | ")} |`);
saveMdkTextFile(
  tableProject,
  "markdown/001.md",
  [
    "# PDF table layout",
    "",
    "| Field | Value |",
    "| --- | --- |",
    `| Wrap | ${"unbroken".repeat(16)} |`,
    "",
    "## Wide table",
    "",
    ...wideTable,
    "",
    ...wideTable.map((line) => `> ${line}`),
  ].join("\n"),
);
createTextFile(
  tableProject,
  "publication.toml",
  `default_preset = "pdf-a4"
[[presets]]
id = "pdf-a4"
format = "pdf"
[presets.pdf]
layout = "flow"
[[presets]]
id = "pdf-wide"
format = "pdf"
[presets.pdf]
layout = "flow"
page_width = 420
margin_left = 5
margin_right = 5
`,
);
createTextFile(defaultProject, "meta/check.json", "{}");
saveMdkTextFile(defaultProject, "markdown/001.md", "# 前言\n\n" + "正文。\n\n".repeat(75) + "## 第二节\n\n继续阅读。\n");
await fs.copyFile(defaultProject, missing);
saveMdkTextFile(missing, "markdown/001.md", "# 缺失资源\n\n![插图](../resources/missing.png)");
const bad = new AdmZip(undefined, { noSort: true });
addArchiveMember(bad, "mimetype", Buffer.from(MDK_MIMETYPE));
addArchiveMember(
  bad,
  "mdk.toml",
  Buffer.from('format_version=3\nproject_id="future"\n'),
);
addArchiveMember(bad, "contents.toml", Buffer.alloc(0));
await fs.writeFile(readonly, bad.toBuffer());
const oldZip = new AdmZip(undefined, { noSort: true });
for (const entry of new AdmZip(await fs.readFile(file)).getEntries())
  addArchiveMember(
    oldZip,
    entry.entryName,
    entry.getData(),
    entry.comment,
    entry.attr,
  );
oldZip.getEntry("markdown/intro.md")!.header.method = 8;
const oldBytes = oldZip.toBuffer();
await fs.writeFile(compressed, oldBytes);
saveMdkTextFile(
  comic,
  "publication.toml",
  readMdkTextFile(comic, "publication.toml").content +
    '\n[[presets]]\nid = "overflow"\nformat = "epub"\n[presets.epub]\nlayout = "fixed"\n',
);
const state = new AppState(profile);
state.preferences({
  ...state.preferences(),
  autosave: false,
  language: "zh-CN",
});
const env = {
  ...process.env,
  MARDIKOR_USER_DATA: profile,
  MARDIKOR_HEADLESS: "offscreen",
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.VITE_DEV_SERVER_URL;
const executablePath = process.env.MARDIKOR_TEST_EXECUTABLE;
const app = await electron.launch({
  ...(executablePath
    ? { executablePath, args: [file] }
    : { args: [".", file] }),
  env,
  timeout: 30000,
});
const page = await app.firstWindow();
page.setDefaultTimeout(30000);
const errors: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));
async function openProject(filePath: string) {
  await app.evaluate(({ dialog }, filename) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [filename],
    });
  }, filePath);
  await page.getByRole("button", { name: "打开工程", exact: true }).click();
  await expect(page.locator(".titlebar-caption")).toHaveText(
    path.basename(filePath),
  );
}
async function exportFile(
  file: string,
  format: "pdf" | "epub",
  id: string,
  name: string,
) {
  const output = path.join(run, name);
  const plan = await page.evaluate(
    ({ file, format, id }) =>
      window.mardikor!.invoke("planPublication", file, format, id),
    { file, format, id },
  );
  assert.equal(plan.report.valid, true, JSON.stringify(plan.report.issues));
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, output);
  await page.evaluate(
    async ({ file, format, id, fingerprint }) => {
      const target = await window.mardikor!.dialog(
        format === "pdf" ? "save-pdf" : "save-epub",
      );
      if (!target) throw new Error("Missing destination");
      await window.mardikor!.invoke(
        "exportPublication",
        file,
        target,
        format,
        fingerprint,
        id,
      );
    },
    { file, format, id, fingerprint: plan.fingerprint },
  );
  return fs.readFile(output);
}
function pdfPageContents(document: PDFDocument) {
  return document.getPages().map((page) => {
    const contents = page.node.Contents();
    const streams = contents instanceof PDFArray
      ? contents.asArray().map((entry) => document.context.lookup(entry, PDFStream))
      : contents ? [contents] : [];
    return {
      size: page.getSize(),
      contents: streams.map((stream) => stream.getContentsString()),
    };
  });
}
try {
  await expect(page.locator(".document-title")).toContainText("markdown/");
  await expect(
    page.getByRole("tab", { name: "预览", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  const oldIntro = await page
    .locator("article[data-entry-id='node-intro'] h1")
    .elementHandle();
  const preview = page.locator(".reading-preview article[data-source-path]");
  await expect(preview).toHaveCount(1);
  const oldTree = await page
    .locator(".project-tree-row[data-entry-id='node-intro']")
    .elementHandle();
  await page.locator(".editor-workspace").evaluate((element) => {
    const watch = new MutationObserver((records) => {
      if (
        records.some((record) => record.oldValue?.includes("is-busy")) ||
        element.classList.contains("is-busy")
      )
        (element as HTMLElement).dataset.busyOnSwitch = "yes";
    });
    watch.observe(element, {
      attributes: true,
      attributeFilter: ["class"],
      attributeOldValue: true,
    });
  });
  for (const [id, name] of [
    ["node-road", "road"],
    ["node-intro", "intro"],
    ["node-intro-again", "intro"],
    ["node-intro", "intro"],
  ]) {
    await page.locator(`.project-tree-row[data-entry-id='${id}']`).click();
    await expect(page.locator(".document-title")).toContainText(
      `markdown/${name}.md`,
    );
    await expect(preview).toHaveCount(1);
    await expect(preview).toHaveAttribute("data-entry-id", id);
  }
  assert.equal(await oldTree!.evaluate((node) => node.isConnected), true);
  assert.equal(await oldIntro!.evaluate((node) => node.isConnected), false);
  assert.equal(
    await page.locator(".editor-workspace").getAttribute("data-busy-on-switch"),
    null,
  );
  await page.getByRole("button", { name: "查找", exact: true }).click();
  const query = page.getByRole("textbox", { name: "查找文字" });
  await query.fill("山路");
  const count = page.getByRole("search").getByRole("status");
  await expect(count).toHaveText("0 / 2");
  await query.press("Enter");
  await expect(count).toHaveText("1 / 2");
  await expect
    .poll(() =>
      page.evaluate(() =>
        ["mardikor-document-find", "mardikor-document-find-matches"].every(
          (name) =>
            [...(CSS.highlights.get(name) ?? [])].some(
              (range) => range.startContainer.isConnected,
            ),
        ),
      ),
    )
    .toBe(true);
  await query.press("Enter");
  await expect(count).toHaveText("2 / 2");
  await query.press("Shift+Enter");
  await expect(count).toHaveText("1 / 2");
  await query.press("Escape");
  await expect(
    page.getByRole("tab", { name: "阅读", exact: true }),
  ).toBeEnabled();
  await page.getByRole("tab", { name: "阅读", exact: true }).click();
  await expect(
    page.locator("[data-source-path='markdown/intro.md']").first(),
  ).toBeVisible();
  await page.getByRole("link", { name: "山路", exact: true }).first().click();
  await expect(
    page.locator("article[data-entry-id='node-road']"),
  ).toBeVisible();
  await page.getByRole("button", { name: "校验与导出", exact: true }).click();
  const info = await page.evaluate(
    (source) => window.mardikor!.invoke("publicationInfo", source),
    file,
  );
  assert.deepEqual(
    info.presets?.map(({ id }) => id),
    ["pdf-a5", "epub-reflow"],
  );
  await app.evaluate(({ dialog }) => {
    dialog.showSaveDialog = async () => {
      throw new Error("PDF preview opened a save dialog");
    };
  });
  const previewButton = page.getByRole("button", { name: "预览 PDF", exact: true });
  await previewButton.click();
  await expect(previewButton).toBeEnabled({ timeout: 30000 });
  const pdfWindowUrl = "mardikor-pdf-preview:";
  await expect.poll(() => app.evaluate(({ BrowserWindow }, url) =>
    BrowserWindow.getAllWindows().some(({ webContents }) =>
      webContents.getURL().startsWith(url) &&
      webContents.mainFrame.framesInSubtree.some(({ url }) => url.startsWith("chrome-extension:")),
    ), pdfWindowUrl),
  ).toBe(true);
  const previewData = await app.evaluate(async ({ BrowserWindow }, url) => {
    const { webContents } = BrowserWindow.getAllWindows().find(
      (window) => window.webContents.getURL().startsWith(url),
    )!;
    const result = await webContents.session.fetch(webContents.getURL());
    return Buffer.from(await result.arrayBuffer()).toString("base64");
  }, pdfWindowUrl);
  assert.equal((await fs.readdir(run)).some((name) => name.endsWith(".pdf")), false);
  const previewPdf = await PDFDocument.load(Buffer.from(previewData, "base64"));
  for (const [format, id] of [
    ["pdf", "pdf-a5"],
    ["epub", "epub-reflow"],
  ] as const) {
    const bytes = await exportFile(file, format, id, "book." + format);
    if (format === "pdf") {
      const exported = await PDFDocument.load(bytes);
      assert.ok(exported.getPageCount() >= 4);
      assert.deepEqual(pdfPageContents(previewPdf), pdfPageContents(exported));
    } else {
      validateGeneratedEpub(bytes);
      const zip = new AdmZip(bytes);
      assert.match(zip.readAsText("EPUB/package.opf"), /cover-image/);
      assert.ok(zip.getEntry("EPUB/chapter-0004.xhtml"));
    }
  }
  await openProject(comic);
  assert.equal(await app.evaluate(({ BrowserWindow }, url) =>
    BrowserWindow.getAllWindows().some(({ webContents }) => webContents.getURL().startsWith(url)),
  pdfWindowUrl), false);
  await expect(page.locator(".document-title")).toContainText(
    "markdown/one.md",
  );
  await expect(preview).toHaveCount(1);
  await expect(preview).toHaveAttribute("data-entry-id", "node-one");
  await page.locator(".project-tree-row[data-entry-id='node-two']").click();
  await expect(preview).toHaveCount(1);
  await expect(preview).toHaveAttribute("data-entry-id", "node-two");
  await page.locator(".project-tree-row[data-entry-id='node-one']").click();
  await page.getByRole("tab", { name: "阅读", exact: true }).click();
  await expect(page.locator("article[data-entry-id='node-one']")).toBeVisible();
  await page.getByRole("button", { name: "校验与导出", exact: true }).click();
  const overflow = await page.evaluate(
    (source) =>
      window.mardikor!.invoke("planPublication", source, "epub", "overflow"),
    comic,
  );
  assert.equal(overflow.report.valid, false);
  assert(
    overflow.report.issues.some(({ code }) => code === "E_PUBLICATION_LAYOUT"),
  );
  const fixed = await exportFile(comic, "epub", "comic-fixed", "comic.epub");
  validateGeneratedEpub(fixed);
  const opf = new AdmZip(fixed).readAsText("EPUB/package.opf");
  assert.match(opf, /pre-paginated/);
  assert.match(opf, /page-progression-direction="rtl"/);
  assert.match(opf, /chapter-0" properties="page-spread-right"/);
  assert.match(opf, /chapter-1" properties="page-spread-left"/);
  assert.match(opf, /chapter-2" properties="page-spread-right"/);

  await openProject(tableProject);
  await page.getByRole("button", { name: "校验与导出", exact: true }).click();
  const tableOptions = page.getByRole("region", { name: "PDF 与 EPUB 导出" });
  await tableOptions
    .getByRole("button", { name: "严格预检", exact: true })
    .click();
  const tableReport = tableOptions.getByRole("region", {
    name: "出版转换校验结果",
  });
  await expect(tableReport).toContainText("严格预检未通过");
  await expect(tableReport).toContainText("第 9 行的表格");
  await expect(tableReport).toContainText("第 13 行的表格");
  await expect(
    tableReport.getByRole("button", { name: "markdown/001.md", exact: true }),
  ).toHaveCount(2);
  await tableOptions.getByRole("button", { name: "预览 PDF", exact: true }).click();
  await expect(tableReport).toContainText("严格预检未通过");
  assert.equal(await app.evaluate(({ BrowserWindow }, url) =>
    BrowserWindow.getAllWindows().some(({ webContents }) => webContents.getURL().startsWith(url)),
  pdfWindowUrl), false);
  const tablePlan = await page.evaluate(
    (file) => window.mardikor!.invoke("planPublication", file, "pdf", "pdf-a4"),
    tableProject,
  );
  assert.deepEqual(
    tablePlan.report.issues.map(({ code }) => code),
    ["E_PDF_TABLE_WIDTH", "E_PDF_TABLE_WIDTH"],
  );
  const blockedPdf = path.join(run, "tables-narrow.pdf");
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, blockedPdf);
  await assert.rejects(
    page.evaluate(async ({ file, fingerprint }) => {
      const target = await window.mardikor!.dialog("save-pdf");
      await window.mardikor!.invoke(
        "exportPublication", file, target!, "pdf", fingerprint, "pdf-a4",
      );
    }, { file: tableProject, fingerprint: tablePlan.fingerprint }),
    /第 9 行的表格/,
  );
  await assert.rejects(fs.access(blockedPdf), { code: "ENOENT" });
  const tablesPdf = await exportFile(
    tableProject, "pdf", "pdf-wide", "tables-wide.pdf",
  );
  assert.ok((await PDFDocument.load(tablesPdf)).getPageCount() >= 1);

  await openProject(fontProject);
  await expect(preview).toHaveCSS("font-family", /MardikorFallback/);
  await expect.poll(() => page.evaluate(async () =>
    (await document.fonts.load("16px MardikorFallback", "汉字")).some((face) => face.status === "loaded"),
  )).toBe(true);
  await page.getByRole("button", { name: "校验与导出", exact: true }).click();
  const fontOptions = page.getByRole("region", { name: "PDF 与 EPUB 导出" });
  const fontSelector = fontOptions.getByRole("combobox", { name: "导出字体", exact: true });
  const fontReport = fontOptions.getByRole("region", { name: "出版转换校验结果" });
  await fontOptions.getByRole("button", { name: "严格预检", exact: true }).click();
  await expect(fontReport).toContainText("字体文件缺失");
  await fontSelector.click();
  await page.getByRole("option", { name: "Noto Sans CJK SC（内置回退字体）", exact: true }).click();
  await fontOptions.getByRole("button", { name: "保存并预检", exact: true }).click();
  await expect(fontReport).toContainText("严格预检通过", { timeout: 30000 });
  assert.match(readMdkTextFile(fontProject, "settings.toml").content, /Missing\.otf/);

  await app.evaluate(({ dialog }, filename) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] });
  }, sampleFont);
  await fontOptions.getByRole("button", { name: "打包字体文件", exact: true }).click();
  await expect(fontSelector).toHaveAttribute("data-value", packedFont);
  await fontOptions.getByRole("button", { name: "保存并预检", exact: true }).click();
  await expect(fontReport).toContainText("严格预检通过", { timeout: 30000 });
  const withFont = new AdmZip(await fs.readFile(fontProject));
  assert.ok(withFont.getEntry(packedFont));
  assert.ok(withFont.getEntry("resources/other/Mardikor-Noto-OFL.txt"));
  assert.match(withFont.readAsText("publication.toml"), /font = "resources\/font\/NotoSerifCJKsc-Regular\.otf"/);
  const fontPdf = await PDFDocument.load(await exportFile(fontProject, "pdf", "pdf", "packed-font.pdf"));
  assert.ok(fontPdf.context.enumerateIndirectObjects().some(([, object]) =>
    object instanceof PDFDict && /NotoSerifCJKsc/.test(
      object.lookupMaybe(PDFName.of("FontName"), PDFName)?.decodeText() ?? "",
    ),
  ));
  await fontOptions.getByRole("combobox", { name: "出版导出格式", exact: true }).click();
  await page.getByRole("option", { name: "EPUB 3 电子书", exact: true }).click();
  await fontSelector.click();
  await page.getByRole("option", { name: packedFont, exact: true }).click();
  await expect(fontOptions.getByRole("checkbox", { name: "嵌入字体", exact: true })).toBeChecked();
  await fontOptions.getByRole("button", { name: "保存并预检", exact: true }).click();
  await expect(fontReport).toContainText("严格预检通过", { timeout: 30000 });
  const fontEpub = new AdmZip(await exportFile(fontProject, "epub", "epub", "packed-font.epub"));
  assert.ok(fontEpub.getEntry("EPUB/assets/body-font.otf"));
  await page.getByRole("button", { name: "返回文稿", exact: true }).click();
  await page.getByRole("tab", { name: "工程设置", exact: true }).click();
  await page.getByRole("combobox", { name: "字体", exact: true }).click();
  await page.getByRole("option", { name: packedFont, exact: true }).click();
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect.poll(() => readMdkTextFile(fontProject, "settings.toml").content).toContain(packedFont);
  await page.getByRole("tab", { name: "预览", exact: true }).click();
  await expect(preview).toHaveCSS("font-family", /MardikorProjectFont/);

  await openProject(minimal);
  await page.getByRole("tab", { name: "工程设置", exact: true }).click();
  await page.getByRole("button", { name: "编辑出版预设" }).click();
  await expect(
    page.getByRole("tab", { name: "源码", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("textbox", { name: "源码编辑器" })).toBeVisible();
  await page.getByRole("tab", { name: "工程设置", exact: true }).click();
  await page.getByRole("button", { name: "编辑出版预设" }).click();
  await expect(
    page.getByRole("tab", { name: "源码", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "校验与导出", exact: true }).click();
  const options = page.getByRole("region", { name: "PDF 与 EPUB 导出" });
  const saveOptions = options.getByRole("button", { name: "保存导出配置至工程", exact: true });
  const choose = async (label: string, value: string) => {
    await options.getByRole("combobox", { name: label, exact: true }).click();
    await page.getByRole("option", { name: value, exact: true }).click();
  };
  await expect(options.getByRole("button", { name: "导出 PDF", exact: true })).toBeVisible();
  await expect(options.getByRole("button", { name: /^新建.*预设$/ })).toHaveCount(0);
  await expect(options.getByRole("spinbutton", { name: "纸张宽度（mm）", exact: true })).toHaveValue("210");
  await expect(saveOptions).toBeDisabled();
  await options.getByRole("button", { name: "严格预检", exact: true }).click();
  await expect(options.getByRole("region", { name: "出版转换校验结果" })).toContainText("严格预检未通过");
  assert.equal(new AdmZip(await fs.readFile(minimal)).getEntry("publication.toml"), null);
  const paperWidth = options.getByRole("spinbutton", { name: "纸张宽度（mm）", exact: true });
  await paperWidth.fill("24");
  await expect(paperWidth).toHaveAttribute("aria-invalid", "true");
  await expect(paperWidth).toHaveAccessibleDescription("边距总和必须小于纸张尺寸。");
  await saveOptions.click();
  await expect(options.getByRole("alert")).toHaveText("边距总和必须小于纸张尺寸。");
  assert.equal(new AdmZip(await fs.readFile(minimal)).getEntry("publication.toml"), null);
  await paperWidth.fill("148");
  await expect(paperWidth).not.toHaveAttribute("aria-invalid", "true");
  await options.getByRole("spinbutton", { name: "纸张高度（mm）", exact: true }).fill("210");
  await options.getByRole("checkbox", { name: "生成目录页", exact: true }).check();
  await choose("出版导出格式", "EPUB 3 电子书");
  await expect(options.getByRole("button", { name: "预览 PDF", exact: true })).toHaveCount(0);
  await expect(options.getByRole("button", { name: "导出 EPUB", exact: true })).toBeVisible();
  await choose("出版版式", "固定版式");
  await expect(options.getByRole("checkbox", { name: "嵌入字体", exact: true })).toBeChecked();
  await options.getByRole("spinbutton", { name: "页面宽度（px）", exact: true }).fill("900");
  await choose("分页布局", "双页");
  await options.getByRole("checkbox", { name: "首项单页", exact: true }).check();
  await options.getByText("作品信息与封面", { exact: true }).click();
  await options.getByRole("textbox", { name: "作品标题", exact: true }).fill("测试作品");
  await options.getByRole("textbox", { name: "语言", exact: true }).fill("zh-CN");
  await options.getByRole("textbox", { name: "出版物标识", exact: true }).fill("urn:example:export-options");
  assert.equal(new AdmZip(await fs.readFile(minimal)).getEntry("publication.toml"), null);
  await expect(page.locator(".editor-statusbar")).toContainText("有未保存的更改");
  await page.getByRole("button", { name: "返回文稿", exact: true }).click();
  await page.getByRole("button", { name: "校验与导出", exact: true }).click();
  await expect(options.getByRole("spinbutton", { name: "页面宽度（px）", exact: true })).toHaveValue("900");
  await page.keyboard.press("Control+s");
  await expect(page.locator(".save-label")).toHaveText("已保存");
  await expect(saveOptions).toBeDisabled();
  await expect(options.getByRole("button", { name: "导出 EPUB", exact: true })).toBeVisible();
  assert.match(readMdkTextFile(minimal, "mdk.toml").content, /测试作品/);
  const epubOptions = readMdkTextFile(minimal, "publication.toml").content;
  assert.match(epubOptions, /id = "epub"[\s\S]*layout = "fixed"[\s\S]*page_width = 900/);
  assert.match(epubOptions, /first_single = true/);
  await choose("出版导出格式", "PDF 文档");
  await expect(options.getByRole("spinbutton", { name: "纸张宽度（mm）", exact: true })).toHaveValue("148");
  await expect(options.getByRole("button", { name: "导出 PDF", exact: true })).toBeVisible();
  assert.match(
    readMdkTextFile(minimal, "publication.toml").content,
    /id = "pdf"[\s\S]*page_width = 148[\s\S]*id = "epub"/,
  );
  await page.screenshot({ path: path.join(run, "publication-options.png") });
  await paperWidth.fill("152");
  await page.getByRole("button", { name: "返回文稿", exact: true }).click();

  await openProject(defaultProject);
  assert.match(readMdkTextFile(minimal, "publication.toml").content, /page_width = 152/);
  const beforeExport = await fs.readFile(defaultProject);
  const defaultPdf = path.join(run, "default.pdf");
  const secondHeading = page.locator(".reading-preview").getByRole("heading", { name: "第二节" });
  await expect(secondHeading).toBeAttached();
  await expect(secondHeading).not.toBeInViewport();
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, defaultPdf);
  await page.getByRole("button", { name: "校验与导出", exact: true }).click();
  await page.getByRole("button", { name: "导出 PDF", exact: true }).click();
  await expect.poll(async () => (await fs.stat(defaultPdf).catch(() => null))?.size ?? 0).toBeGreaterThan(0);
  assert.ok((await PDFDocument.load(await fs.readFile(defaultPdf))).getPageCount() > 0);
  assert.deepEqual(await fs.readFile(defaultProject), beforeExport);

  await page.locator(".heading-outline").getByText("第二节", { exact: true }).click();
  await expect(options).toBeHidden();
  await expect(secondHeading).toBeInViewport();
  await page.getByRole("button", { name: "校验与导出", exact: true }).click();
  await page.getByRole("button", { name: "MDK / MDKE", exact: true }).click();
  const preflight = page.getByRole("button", { name: "交付预检", exact: true });
  await preflight.click();
  await page.getByRole("checkbox", { name: "meta/check.json", exact: true }).uncheck();
  await expect(page.locator(".export-meta-plan")).toContainText("剔除：meta/check.json");
  await expect(page.getByText("交付范围已更改，请重新预检", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "导出 .mdk", exact: true })).toBeDisabled();
  await preflight.click();
  await expect(page.getByRole("button", { name: "导出 .mdk", exact: true })).toBeEnabled();

  await openProject(missing);
  await page.getByRole("button", { name: "校验与导出", exact: true }).click();
  await page.getByRole("button", { name: "MDK / MDKE", exact: true }).click();
  await page.getByRole("button", { name: "校验工程", exact: true }).click();
  const issue = page.locator(".issue").filter({ hasText: "missing.png" });
  await issue.getByRole("button", { name: "markdown/001.md", exact: true }).click();
  await expect(page.locator(".delivery-page")).toBeHidden();

  await openProject(readonly);
  await expect(page.locator(".project-diagnostics summary")).toContainText(
    "工程为只读",
  );
  await expect(
    page.getByRole("button", { name: "保存", exact: true }),
  ).toBeDisabled();
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [filePath],
    });
  }, compressed);
  await page.getByRole("button", { name: "打开工程", exact: true }).click();
  const rejection = page
    .getByRole("alert")
    .filter({ hasText: "MDK v2 禁止容器压缩" });
  await expect(rejection).toContainText("markdown/intro.md");
  await expect(page.locator(".titlebar-caption")).toHaveText(
    path.basename(readonly),
  );
  assert.deepEqual(await fs.readFile(compressed), oldBytes);
  assert.deepEqual(errors, []);
  await openProject(defaultProject);
  await page.getByRole("button", { name: "校验与导出", exact: true }).click();
  await paperWidth.fill("168");
  await expect(page.locator(".editor-statusbar")).toContainText("有未保存的更改");
  await app.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 0; });
  await Promise.all([
    page.waitForEvent("close"),
    page.getByRole("button", { name: "关闭窗口", exact: true }).click(),
  ]);
  assert.match(readMdkTextFile(defaultProject, "publication.toml").content, /page_width = 168/);
  console.log(
    "Electron v2 reader, named preflight, PDF, EPUB, and rejection of compressed MDK:",
    run,
  );
} finally {
  await page.evaluate(() => window.mardikor?.setDirty(false)).catch(() => {});
  await app.close();
}
