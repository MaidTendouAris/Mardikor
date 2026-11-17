import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { _electron as electron, expect } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import AdmZip from "adm-zip";
import {
  MDK_MIMETYPE,
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
const readonly = path.join(run, "readonly.mdk");
const profile = path.join(run, "profile");
packMdk("docs/examples/v2/book", file);
packMdk("docs/examples/v2/comic", comic);
packMdk("docs/examples/v2/minimal", minimal);
const bad = new AdmZip(undefined, { noSort: true });
addArchiveMember(bad, "mimetype", Buffer.from(MDK_MIMETYPE));
addArchiveMember(
  bad,
  "mdk.toml",
  Buffer.from('format_version=3\nproject_id="future"\n'),
);
addArchiveMember(bad, "contents.toml", Buffer.alloc(0));
await fs.writeFile(readonly, bad.toBuffer());
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
try {
  await expect(page.locator(".document-title")).toContainText("markdown/");
  await expect(
    page.getByRole("tab", { name: "预览", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  const oldIntro = await page
    .locator("article[data-entry-id='node-intro'] h1")
    .elementHandle();
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
  ]) {
    await page.locator(`.project-tree-row[data-entry-id='${id}']`).click();
    await expect(page.locator(".document-title")).toContainText(
      `markdown/${name}.md`,
    );
  }
  assert.equal(await oldTree!.evaluate((node) => node.isConnected), true);
  assert.equal(await oldIntro!.evaluate((node) => node.isConnected), true);
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
  for (const [format, id] of [
    ["pdf", "pdf-a5"],
    ["epub", "epub-reflow"],
  ] as const) {
    const bytes = await exportFile(file, format, id, "book." + format);
    if (format === "pdf")
      assert.ok((await PDFDocument.load(bytes)).getPageCount() >= 4);
    else {
      validateGeneratedEpub(bytes);
      const zip = new AdmZip(bytes);
      assert.match(zip.readAsText("EPUB/package.opf"), /cover-image/);
      assert.ok(zip.getEntry("EPUB/chapter-0004.xhtml"));
    }
  }
  await openProject(comic);
  await expect(page.locator(".document-title")).toContainText(
    "markdown/one.md",
  );
  await expect(page.locator(".reading-spread.double.rtl")).toBeVisible();
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
  await page.getByRole("button", { name: "新建 PDF 预设" }).click();
  await expect(
    page.getByRole("button", { name: "导出 PDF", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "新建 EPUB 预设" }).click();
  await expect(
    page.getByRole("button", { name: "导出 EPUB", exact: true }),
  ).toBeVisible();
  assert.match(
    readMdkTextFile(minimal, "publication.toml").content,
    /id = "pdf"[\s\S]*id = "epub"/,
  );

  await openProject(readonly);
  await expect(page.locator(".project-diagnostics summary")).toContainText(
    "工程为只读",
  );
  await expect(
    page.getByRole("button", { name: "保存", exact: true }),
  ).toBeDisabled();
  assert.deepEqual(errors, []);
  console.log(
    "Electron v2 reader, named preflight, PDF, reflowable EPUB and RTL fixed EPUB:",
    run,
  );
} finally {
  await page.evaluate(() => window.mardikor?.setDirty(false)).catch(() => {});
  await app.close();
}
