import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import AdmZip from "adm-zip";
import { PDFDict, PDFDocument, PDFName } from "pdf-lib";
import { _electron as electron, expect } from "@playwright/test";
import {
  createMdkProject,
  readMdkTextFile,
  saveMdkTextFile,
} from "../electron/mdk";
import { systemFontReference } from "../shared/fonts";

const root = path.resolve(".test-artifacts/system-fonts");
await fs.mkdir(root, { recursive: true });
const run = await fs.mkdtemp(path.join(root, "run-"));
const file = path.join(run, "fonts.mdk");
const local = path.join(run, "fonts.md");
createMdkProject(file, "00");
saveMdkTextFile(
  file,
  "mdk.toml",
  readMdkTextFile(file, "mdk.toml").content +
    '\n[metadata]\ntitle = "System Fonts"\nlanguage = "en"\nidentifier = "urn:mardikor:system-fonts"\n',
);
await fs.writeFile(local, "# Local document\n\nFont search works.\n");

const executablePath = process.env.MARDIKOR_TEST_EXECUTABLE;
const app = await electron.launch({
  executablePath,
  args: executablePath ? [file] : [".", file],
  env: {
    ...process.env,
    MARDIKOR_USER_DATA: path.join(run, "profile"),
    MARDIKOR_HEADLESS: "offscreen",
    MARDIKOR_TEST_SYSTEM_LOCALE: "zh-CN",
  },
});
const page = await app.firstWindow();
page.setDefaultTimeout(30000);

async function exportFile(
  source: string,
  format: "pdf" | "epub",
  filename: string,
) {
  const plan = await page.evaluate(
    ({ source, format }) =>
      window.mardikor!.invoke("planPublication", source, format),
    { source, format },
  );
  assert.equal(plan.report.valid, true, JSON.stringify(plan.report.issues));
  const output = path.join(run, filename);
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, output);
  await page.evaluate(
    async ({ source, format, fingerprint }) => {
      const target = await window.mardikor!.dialog(
        format === "pdf" ? "save-pdf" : "save-epub",
      );
      await window.mardikor!.invoke(
        "exportPublication",
        source,
        target!,
        format,
        fingerprint,
      );
    },
    { source, format, fingerprint: plan.fingerprint },
  );
  return fs.readFile(output);
}

try {
  await expect(
    page.getByRole("tab", { name: "工程设置", exact: true }),
  ).toBeEnabled();
  const catalog = await page.evaluate(() => window.mardikor!.systemFonts());
  const font =
    catalog.find(({ postscriptName }) => postscriptName === "MicrosoftYaHei") ??
    catalog.find(({ postscriptName }) => postscriptName === "ArialMT");
  assert.ok(
    font,
    "A Windows test font should be present in the native catalog",
  );
  const value = systemFontReference(font.postscriptName);
  const search = page.getByRole("searchbox", { name: "搜索字体", exact: true });
  const option = page
    .getByRole("option")
    .and(page.locator(`[data-value="${value}"]`));

  await page.getByRole("tab", { name: "工程设置", exact: true }).click();
  const documentFont = page.getByRole("combobox", {
    name: "字体",
    exact: true,
  });
  await documentFont.click();
  await search.fill("mardikor-font-does-not-exist");
  await expect(page.getByText("没有匹配的字体", { exact: true })).toBeVisible();
  await search.press("Escape");
  await expect(documentFont).toHaveAttribute("data-value", "sans-serif");
  await documentFont.click();
  await search.fill(font.fullName);
  await expect(option).toBeVisible();
  await search.fill(font.postscriptName);
  await option.click();
  await expect(documentFont).toHaveAttribute("data-value", value);
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect
    .poll(() => readMdkTextFile(file, "settings.toml").content)
    .toContain(`system_font = "${font.postscriptName}"`);
  await page.getByRole("tab", { name: "预览", exact: true }).click();
  await expect(page.locator(".reading-preview article")).toHaveCSS(
    "font-family",
    /MardikorProjectFont/,
  );
  assert.equal(
    new AdmZip(await fs.readFile(file))
      .getEntries()
      .some(
        (entry) =>
          entry.entryName.startsWith("resources/font/") && !entry.isDirectory,
      ),
    false,
  );

  const pdf = await PDFDocument.load(
    await exportFile(file, "pdf", "system.pdf"),
  );
  const pdfNames = pdf.context
    .enumerateIndirectObjects()
    .flatMap(([, object]) =>
      object instanceof PDFDict
        ? [
            object.lookupMaybe(PDFName.of("FontName"), PDFName)?.decodeText(),
            object.lookupMaybe(PDFName.of("BaseFont"), PDFName)?.decodeText(),
          ]
        : [],
    );
  assert.ok(
    pdfNames.some((name) => name?.includes(font.postscriptName)),
    JSON.stringify(pdfNames),
  );
  const epub = new AdmZip(await exportFile(file, "epub", "system.epub"));
  assert.ok(epub.getEntry("EPUB/assets/body-font.ttf"));

  await page.getByRole("button", { name: "校验与导出", exact: true }).click();
  const mdkFont = page.getByRole("combobox", { name: "导出字体", exact: true });
  await expect(mdkFont).toHaveAttribute("data-value", "inherit");
  await mdkFont.click();
  await search.fill("内置回退字体");
  await search.press("Enter");
  await expect(mdkFont).toHaveAttribute("data-value", "sans-serif");
  await page.getByRole("button", { name: "保存并预检", exact: true }).click();
  const report = page.getByRole("region", { name: "出版转换校验结果", exact: true });
  await expect(report).toContainText("严格预检通过", { timeout: 30000 });
  const overridden = await page.evaluate((file) => window.mardikor!.invoke("planPublication", file, "pdf"), file);
  assert.equal(overridden.font, "sans-serif");
  assert.match(readMdkTextFile(file, "settings.toml").content, /system_font = /);

  await mdkFont.click();
  await search.fill(font.postscriptName);
  await option.click();
  await page.getByRole("button", { name: "保存并预检", exact: true }).click();
  await expect(report).toContainText("严格预检通过", { timeout: 30000 });
  assert.ok(readMdkTextFile(file, "publication.toml").content.includes(`system_font = "${font.postscriptName}"`));

  await app.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [filePath],
    });
  }, local);
  await page.getByRole("button", { name: "打开工程", exact: true }).click();
  await expect(page.locator(".titlebar-caption")).toHaveText("fonts.md");
  await page.getByRole("button", { name: "校验与导出", exact: true }).click();
  const exportFont = page.getByRole("combobox", {
    name: "导出字体",
    exact: true,
  });
  await exportFont.click();
  await search.fill(font.postscriptName);
  await option.click();
  await expect(exportFont).toHaveAttribute("data-value", value);
  await page.getByRole("button", { name: "保存并预检", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "出版转换校验结果", exact: true }),
  ).toContainText("严格预检通过", { timeout: 30000 });
  const standalone = await PDFDocument.load(
    await exportFile(local, "pdf", "local.pdf"),
  );
  assert.ok(standalone.getPageCount());
  console.log(
    `Native font search, ${font.fullName}, MDK and standalone PDF, and EPUB passed.`,
  );
} finally {
  await page.evaluate(() => window.mardikor?.setDirty(false)).catch(() => {});
  await app.close();
}
