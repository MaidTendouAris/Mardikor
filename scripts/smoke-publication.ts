import {
  _electron as electron,
  expect,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  decodePDFRawStream,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFHexString,
  PDFRawStream,
  PDFString,
} from "pdf-lib";
import * as mdk from "../electron/mdk";
import { AppState } from "../electron/state";
import { validateGeneratedEpub } from "../electron/epub";
import { selectOption } from "./select-option.mjs";

const executablePath = process.env.MARDIKOR_TEST_EXECUTABLE;
const root = path.resolve(
  executablePath
    ? ".test-artifacts/publication-packaged"
    : ".test-artifacts/publication-desktop",
);
await fs.mkdir(root, { recursive: true });
const run = await fs.mkdtemp(path.join(root, "run-"));
const file = path.join(run, "book.mdk"),
  comic = path.join(run, "comic.mdk");
mdk.createMdkProject(file, "01");
mdk.addMdkEntry(file, "002.md");
mdk.importMdkResource(file, path.resolve("assets/icon.png"), "image");
mdk.createTextFile(
  file,
  "resources/image/vector.svg",
  '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80"><path fill="#2563eb" d="M10 10H70V70H10Z"/></svg>',
);
mdk.saveMdkTextFile(
  file,
  "markdown/001.md",
  "# 第一章\n\n可复现 PDF 与 EPUB 出版验证。\n\n正文包含 **加粗**、*斜体*、~~删除线~~ 和 `代码`。\n\n[转到第二章](002.md#第二章)\n\n## 内容\n\n> 引用内容\n\n- [x] 已完成\n- [ ] 待完成\n\n| 项目 | 值 |\n| --- | ---: |\n| 标准 | EPUB 3 |\n\n```ts\nconst answer = 42;\n```\n\n![示例图片](../resources/image/icon.png)\n\n脚注示例[^1]。\n\n[^1]: 第一章的脚注。",
);
mdk.saveMdkTextFile(
  file,
  "markdown/002.md",
  "# 第二章\n\n" +
    "这里验证中文段落、自然换行和分页后的正文完整性。\n\n".repeat(26),
);
mdk.createMdkProject(comic, "02");
mdk.saveMdkTextFile(
  file,
  "markdown/002.md",
  mdk.readMdkTextFile(file, "markdown/002.md").content +
    "\n\n![矢量图](../resources/image/vector.svg)",
);
mdk.addMdkEntry(comic, "002.md");
mdk.addMdkEntry(comic, "003.md");
mdk.importMdkResource(comic, path.resolve("assets/icon.png"), "image");
for (const name of ["001", "002", "003"])
  mdk.saveMdkTextFile(
    comic,
    `markdown/${name}.md`,
    `![漫画第 ${name} 页](../resources/image/icon.png)`,
  );
async function launch(file: string, profileName: string) {
  const profile = path.join(run, profileName);
  new AppState(profile).preferences({
    autosave: false,
    autosaveInterval: 30,
    directorySyncThreshold: 200,
  });
  const env = {
    ...process.env,
    MARDIKOR_USER_DATA: profile,
    MARDIKOR_HEADLESS: "offscreen",
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.VITE_DEV_SERVER_URL;
  const app = await electron.launch({
    ...(executablePath
      ? { executablePath, args: ["--disable-gpu", file] }
      : { args: [".", file] }),
    env,
    timeout: 30000,
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(60000);
  try {
    // Distributed projects include the 16 MiB embedded font as well as text.
    await expect(page.locator(".document-title")).toContainText(
      "markdown/001.md",
      { timeout: 30000 },
    );
  } catch (error) {
    await page.evaluate(() => window.mardikor?.setDirty(false)).catch(() => {});
    await app.close();
    throw error;
  }
  return { app, page };
}
async function output(
  app: ElectronApplication,
  page: Page,
  source: string,
  format: "pdf" | "epub",
  target: string,
) {
  const plan = await page.evaluate(
    async ({ source, format }) =>
      window.mardikor!.invoke("planPublication", source, format),
    { source, format },
  );
  expect(plan.report.issues.filter((i) => i.severity === "error")).toEqual([]);
  await app.evaluate(({ dialog }, target) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: target });
  }, target);
  const result = await page.evaluate(
    async ({ source, format, fingerprint }) => {
      const target = await window.mardikor!.dialog(
        format === "pdf" ? "save-pdf" : "save-epub",
      );
      return window.mardikor!.invoke(
        "exportPublication",
        source,
        target!,
        format,
        fingerprint,
      );
    },
    { source, format, fingerprint: plan.fingerprint },
  );
  expect((await fs.stat(target)).size).toBe(result.bytes);
  return result;
}
const { app, page } = await launch(file, "profile-a");
const errors: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  await page.getByRole("button", { name: "校验与导出", exact: true }).click();
  const section = page.getByRole("region", {
    name: "PDF 与 EPUB 导出",
    exact: true,
  });
  await section.getByLabel("作品标题", { exact: true }).fill("出版导出验证");
  await section.getByLabel("作者", { exact: true }).fill("Mardikor");
  await selectOption(
    page,
    section.getByRole("combobox", { name: "纸张预设", exact: true }),
    "A5",
  );
  await section
    .getByLabel("页脚", { exact: true })
    .fill("第 {page} 页 / {pages}");
  await section
    .getByRole("button", { name: "保存导出配置至工程", exact: true })
    .click();
  // A save includes font parsing and can outlive the transient toast on a busy
  // machine. Assert the durable file and available action instead.
  await expect
    .poll(() => mdk.readMdkTextFile(file, "settings.toml").content, {
      timeout: 30000,
    })
    .toContain("出版导出验证");
  await expect(
    section.getByRole("button", { name: "严格预检", exact: true }),
  ).toBeEnabled({ timeout: 30000 });
  await section.getByRole("button", { name: "严格预检", exact: true }).click();
  await expect(
    section.getByRole("region", { name: "出版转换校验结果", exact: true }),
  ).toContainText("严格预检通过");
  const pdfA = path.join(run, "book-a.pdf"),
    pdfB = path.join(run, "book-b.pdf");
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
  }, pdfA);
  await section.getByRole("button", { name: "导出 PDF", exact: true }).click();
  await expect
    .poll(
      () =>
        fs.stat(pdfA).then(
          () => true,
          () => false,
        ),
      { timeout: 60000 },
    )
    .toBe(true);
  const firstBytes = await fs.readFile(pdfA),
    firstDocument = await PDFDocument.load(firstBytes);
  const first = {
    pages: firstDocument.getPageCount(),
    sha256: createHash("sha256").update(firstBytes).digest("hex"),
  };
  const second = await output(app, page, file, "pdf", pdfB);
  expect(first.pages).toBeGreaterThanOrEqual(4);
  expect(first.sha256).toBe(second.sha256);
  const pdf = await PDFDocument.load(await fs.readFile(pdfA));
  expect(pdf.getTitle()).toBe("出版导出验证");
  expect(pdf.getAuthor()).toBe("Mardikor");
  expect(pdf.getPages()[0].getWidth()).toBeCloseTo((148 / 25.4) * 72, 0);
  const titles = pdf.context.enumerateIndirectObjects().flatMap(([, value]) => {
    if (!(value instanceof PDFDict) || !value.has(PDFName.of("Dest")))
      return [];
    const title = value.lookupMaybe(
      PDFName.of("Title"),
      PDFString,
      PDFHexString,
    );
    return title ? [title.decodeText()] : [];
  });
  expect(titles).toContain("1 第一章");
  expect(titles).not.toContain("1 第一章1 第一章");
  const bookEpub = path.join(run, "book.epub");
  await output(app, page, file, "epub", bookEpub);
  validateGeneratedEpub(await fs.readFile(bookEpub));
  await page.screenshot({ path: path.join(root, "export-options.png") });
  console.log(
    "Book PDF typography, pagination, metadata, exact repeated bytes and EPUB conversion passed.",
  );
  const distributed = path.join(run, "分发副本.mdk");
  await fs.copyFile(file, distributed);
  const other = await launch(distributed, "profile-b");
  try {
    const result = await output(
      other.app,
      other.page,
      distributed,
      "pdf",
      path.join(run, "book-distributed.pdf"),
    );
    expect(result.sha256).toBe(first.sha256);
  } finally {
    await other.page.evaluate(() => window.mardikor!.setDirty(false));
    await other.app.close();
  }
  await page.evaluate(async (file) => {
    const info = await window.mardikor!.invoke("publicationInfo", file);
    const c = info.configuration;
    c.publication.metadata.cover = "resources/image/icon.png";
    c.publication.pdf.landscape = true;
    c.publication.pdf.scale = 0.8;
    c.publication.pdf.page_ranges = "2-3";
    c.publication.pdf.first_page_number = 7;
    c.publication.pdf.grayscale = true;
    c.publication.pdf.print_background = false;
    c.publication.pdf.include_cover = true;
    c.publication.pdf.include_toc = false;
    c.publication.epub.embed_font = false;
    await window.mardikor!.invoke(
      "configurePublication",
      file,
      c,
      info.revision,
    );
  }, file);
  const ranged = await output(app, page, file, "pdf", pdfB);
  expect(ranged.pages).toBe(2);
  const landscape = await PDFDocument.load(await fs.readFile(pdfB));
  expect(landscape.getPages()[0].getWidth()).toBeGreaterThan(
    landscape.getPages()[0].getHeight(),
  );
  await output(app, page, file, "epub", path.join(run, "book-cover.epub"));
  console.log(
    "Landscape, page ranges, scale, grayscale, cover and optional EPUB font embedding passed.",
  );
  // Authorize a second project through the same production file-dialog path.
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
  }, comic);
  await page.evaluate(async () => {
    const file = await window.mardikor!.dialog("open-project");
    await window.mardikor!.invoke("open", file!);
  });
  await page.evaluate(async (comic) => {
    const info = await window.mardikor!.invoke("publicationInfo", comic);
    info.configuration.comic.spread_mode = "double";
    info.configuration.comic.reading_direction = "rtl";
    info.configuration.publication.pdf.include_toc = false;
    await window.mardikor!.invoke(
      "configurePublication",
      comic,
      info.configuration,
      info.revision,
    );
  }, comic);
  const comicPdf = await output(
    app,
    page,
    comic,
    "pdf",
    path.join(run, "comic.pdf"),
  );
  expect(comicPdf.pages).toBe(2);
  const comicEpub = path.join(run, "comic.epub");
  await output(app, page, comic, "epub", comicEpub);
  validateGeneratedEpub(await fs.readFile(comicEpub));
  await page.evaluate(async (comic) => {
    const value = await window.mardikor!.invoke(
      "readText",
      comic,
      "markdown/001.md",
    );
    await window.mardikor!.invoke(
      "saveText",
      comic,
      "markdown/001.md",
      value.content + "\n\n" + "超出页面的内容\n\n".repeat(200),
    );
  }, comic);
  const overflow = await page.evaluate(
    async (comic) => window.mardikor!.invoke("planPublication", comic, "epub"),
    comic,
  );
  expect(overflow.report.valid).toBe(false);
  expect(
    overflow.report.issues.some((i) => i.code === "E_PUBLICATION_LAYOUT"),
  ).toBe(true);
  console.log(
    "Copied MDK/profile independence, RTL comic spreads, EPUB fixed layout and overflow refusal passed.",
  );
  const protectedFile = path.join(run, "protected.epub");
  await fs.writeFile(protectedFile, "original");
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
  }, protectedFile);
  const plan = await page.evaluate(
    async (file) => window.mardikor!.invoke("planPublication", file, "epub"),
    file,
  );
  await page.evaluate(() => window.mardikor!.dialog("save-epub"));
  await fs.writeFile(protectedFile, "external-change");
  await expect(
    page.evaluate(
      async ({ file, protectedFile, fingerprint }) =>
        window.mardikor!.invoke(
          "exportPublication",
          file,
          protectedFile,
          "epub",
          fingerprint,
        ),
      { file, protectedFile, fingerprint: plan.fingerprint },
    ),
  ).rejects.toThrow(/输出路径在确认后发生变化/);
  expect(await fs.readFile(protectedFile, "utf8")).toBe("external-change");
  const standalone = path.join(run, "standalone.md");
  await fs.writeFile(
    standalone,
    "# 单 Markdown\n\n普通文件的 PDF 导出。😀🚀👍\n\n:::note\n容器正文。\n:::\n",
  );
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
  }, standalone);
  await page.evaluate(async () => {
    const file = await window.mardikor!.dialog("open-project");
    await window.mardikor!.invoke("open", file!);
  });
  const original = await fs.readFile(standalone);
  await page.evaluate(async (file) => {
    const info = await window.mardikor!.invoke("publicationInfo", file);
    await window.mardikor!.invoke(
      "configurePublication",
      file,
      info.configuration,
      info.revision,
    );
  }, standalone);
  const standalonePdf = path.join(run, "standalone.pdf");
  await output(app, page, standalone, "pdf", standalonePdf);
  const single = await PDFDocument.load(await fs.readFile(standalonePdf));
  expect(single.getPages()[0].getWidth()).toBeCloseTo((210 / 25.4) * 72, 0);
  // Chromium can emit the fallback font as Type 3 without a BaseFont name.
  const unicodeMaps = single.context
    .enumerateIndirectObjects()
    .flatMap(([, value]) => {
      if (!(value instanceof PDFDict)) return [];
      const map = value.lookupMaybe(PDFName.of("ToUnicode"), PDFRawStream);
      return map
        ? [Buffer.from(decodePDFRawStream(map).decode()).toString()]
        : [];
    })
    .join("\n");
  for (const code of ["D83DDE00", "D83DDE80", "D83DDC4D"])
    expect(unicodeMaps).toContain("<" + code + ">");
  expect(await fs.readFile(standalone)).toEqual(original);
  const forbidden = await page.evaluate(
    async (file) => window.mardikor!.invoke("planPublication", file, "epub"),
    standalone,
  );
  expect(forbidden.report.valid).toBe(false);
  expect(
    await fs.stat(path.join(run, "settings.toml")).then(
      () => true,
      () => false,
    ),
  ).toBe(false);
  expect(errors).toEqual([]);
  const hash = createHash("sha256")
    .update(await fs.readFile(pdfA))
    .digest("hex");
  await fs.writeFile(
    path.join(root, "latest.json"),
    JSON.stringify(
      { run, pdf: pdfA, pdfHash: hash, bookEpub, comicEpub },
      null,
      2,
    ),
  );
  console.log(
    "Output conflict protection and standalone PDF-only mode passed. Artifacts: " +
      run,
  );
} catch (error) {
  await page
    .screenshot({ path: path.join(root, "failure.png"), timeout: 10000 })
    .catch(() => {});
  console.error(
    await page
      .locator('[role="alert"]')
      .allTextContents()
      .catch(() => []),
  );
  throw error;
} finally {
  await page.evaluate(() => window.mardikor!.setDirty(false)).catch(() => {});
  await app.close();
}
