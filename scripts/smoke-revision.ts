import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import AdmZip from "adm-zip";
import * as mdk from "../electron/mdk";

const packaged = process.env.MARDIKOR_TEST_EXECUTABLE;
const root = path.resolve(
  packaged
    ? ".test-artifacts/revision-packaged"
    : ".test-artifacts/revision-desktop",
);
await fs.mkdir(root, { recursive: true });
const userData = await fs.mkdtemp(path.join(root, "profile-"));
const file = path.join(root, `revision-${Date.now()}.mdk`),
  kept = file.replace(".mdk", "-kept.mdk"),
  stripped = file.replace(".mdk", "-stripped.mdk");
let project = mdk.createMdkProject(file, "02");
mdk.saveMdkEntry(
  file,
  project.contents.entries[0].id,
  "# 图文一\n\n图片之间的正文必须保留。\n\n- 一个列表项\n\n![一](../resources/image/cover.png)\n\n![二](../resources/image/cover.png)",
);
const image = path.join(root, "cover.png");
await fs.writeFile(
  image,
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1cAAAAASUVORK5CYII=",
    "base64",
  ),
);
mdk.importMdkResource(file, image, "image");
project = mdk.addMdkEntry(file, "text.md");
const second = project.contents.entries.find(
  (e) => e.path === "markdown/text.md",
)!;
mdk.saveMdkEntry(file, second.id, "# 纯文字\n\n没有图片的文稿也合法。");
const control = mdk.readMdkTextFile(file, "contents.toml").content;
mdk.saveMdkTextFile(
  file,
  "contents.toml",
  control +
    '\n[[entries]]\nid="repeat"\npath="markdown/001.md"\nposition="6.1"\n',
);
mdk.createTextFile(
  file,
  "meta/annotations.json",
  '{"comments":["持续保存的批注"]}',
);
mdk.createTextFile(file, "meta/unknown.json", '{"future":true}');
mdk.createTextFile(
  file,
  "meta/editor-state.json",
  '{"schema_version":1,"cursor":{"line":1,"column":1}}',
);
project = mdk.openMdkProject(file);
project.settings.mode.comic.spread_mode = "double";
project.settings.mode.comic.reading_direction = "rtl";
mdk.updateMdkSettings(file, project.settings);
const env = {
  ...process.env,
  MARDIKOR_USER_DATA: userData,
  MARDIKOR_HEADLESS: "1",
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.VITE_DEV_SERVER_URL;
async function launch() {
  return electron.launch({
    ...(packaged
      ? { executablePath: packaged, args: ["--disable-gpu", file] }
      : { args: [".", file] }),
    env,
    timeout: 30000,
  });
}
const app = await launch();
let page;
try {
  await app.evaluate(({ dialog, BrowserWindow }, output) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: output });
    dialog.showMessageBoxSync = () => 2;
    for (const win of BrowserWindow.getAllWindows())
      win.webContents.setBackgroundThrottling(false);
  }, kept);
  page = await app.firstWindow();
  page.setDefaultTimeout(30000);
  await expect(page.locator(".project-heading")).toContainText(
    path.basename(file, ".mdk"),
  );
  await page.getByRole("button", { name: "应用设置", exact: true }).click();
  await page.getByRole("switch", { name: /^自动保存/ }).uncheck();
  await page.getByRole("button", { name: "保存偏好", exact: true }).click();
  await page.getByRole("button", { name: "编辑器", exact: true }).click();
  await page.getByRole("tab", { name: "预览", exact: true }).click();
  await expect(page.locator(".reading-unit")).toHaveCount(3);
  await expect(page.locator(".reading-spread.rtl")).toHaveCount(2);
  await expect(page.locator(".reading-unit").first()).toContainText(
    "图片之间的正文必须保留",
  );
  await expect(page.locator(".reading-unit").nth(1)).toContainText(
    "没有图片的文稿也合法",
  );
  await expect(
    page.locator(".reading-unit").first().locator("img"),
  ).toHaveCount(2);
  await expect(
    page.locator(".reading-spread").last().locator(".reading-unit"),
  ).toHaveCount(1);
  const first = await page.locator(".reading-unit").nth(0).boundingBox(),
    second = await page.locator(".reading-unit").nth(1).boundingBox();
  expect(first!.x).toBeGreaterThan(second!.x);
  if (!packaged)
    await page.screenshot({ path: path.join(root, "comic-full-markdown.png") });
  await page.getByRole("button", { name: "校验与导出", exact: true }).click();
  await page.getByRole("button", { name: "导出 .mdk", exact: true }).click();
  await expect(page.locator('.toast[role="status"]')).toContainText(
    "工程已导出",
  );
  const zip = new AdmZip((await fs.readFile(kept)).subarray(2));
  expect(zip.getEntry("meta/annotations.json")).not.toBeNull();
  expect(zip.getEntry("meta/unknown.json")).not.toBeNull();
  expect(zip.getEntry("meta/editor-state.json")).toBeNull();
  await page.getByRole("button", { name: "编辑器", exact: true }).click();
  await page.getByRole("tab", { name: "工程设置", exact: true }).click();
  await page.getByLabel("保留持久及未知 meta 数据", { exact: true }).uncheck();
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await app.evaluate(({ dialog }, output) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: output });
  }, stripped);
  await page.getByRole("button", { name: "校验与导出", exact: true }).click();
  await page.getByRole("button", { name: "导出 .mdk", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("meta/annotations.json");
  await expect(page.getByRole("dialog")).toContainText("meta/unknown.json");
  await page.getByRole("button", { name: "取消", exact: true }).last().click();
  expect(
    await fs.stat(stripped).then(
      () => true,
      () => false,
    ),
  ).toBe(false);
  await page.getByRole("button", { name: "导出 .mdk", exact: true }).click();
  await page
    .getByRole("button", { name: "确认剔除并交付", exact: true })
    .click();
  await expect(page.locator('.toast[role="status"]')).toContainText(
    "工程已导出",
  );
  expect(
    new AdmZip((await fs.readFile(stripped)).subarray(2))
      .getEntries()
      .some((e) => e.entryName.startsWith("meta/")),
  ).toBe(false);
  expect(
    mdk
      .openMdkProject(file)
      .files.some((f) => f.path === "meta/annotations.json"),
  ).toBe(true);
  await page.getByRole("button", { name: "编辑器", exact: true }).click();
  await page
    .getByRole("button", { name: "contents.toml", exact: true })
    .click();
  await expect(page.locator(".editor-workspace")).not.toHaveClass(/is-busy/);
  await app.evaluate(({ clipboard }) =>
    clipboard.writeText("schema_version = 2"),
  );
  await page.getByRole("textbox", { name: "源码编辑器", exact: true }).focus();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("ControlOrMeta+v");
  await expect(page.locator(".document-title")).toContainText("未保存");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.locator('.toast[role="alert"]')).toContainText(
    "schema_version",
  );
  expect(mdk.openMdkProject(file).contents.schema_version).toBe(1);
  const draft = await page.evaluate(
    (file) => window.mardikor!.recovery(file),
    file,
  );
  expect(draft?.text?.content).toBe("schema_version = 2");
  await page.getByRole("button", { name: "关闭窗口", exact: true }).click();
  expect(
    await app.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
    ),
  ).toBe(1);
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = () => 0;
  });
  await page.getByRole("button", { name: "关闭窗口", exact: true }).click();
  await expect(page.locator('.toast[role="alert"]')).toContainText(
    "schema_version",
  );
  expect(
    await app.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
    ),
  ).toBe(1);
  console.log(
    "Revision desktop passed: complete comic Markdown spreads, RTL, repeated/odd entries, safe meta defaults, explicit metadata exclusion, invalid control preservation, cancel/save-before-close.",
  );
} catch (error) {
  if (page && !packaged)
    await page.screenshot({ path: path.join(root, "failure.png") });
  throw error;
} finally {
  await page?.evaluate(() => window.mardikor!.setDirty(false)).catch(() => {});
  await app.close();
}
const restored = await launch();
try {
  const page = await restored.firstWindow();
  page.setDefaultTimeout(30000);
  await expect(page.getByRole("dialog")).toContainText("恢复未提交的草稿");
  await page.getByRole("button", { name: "恢复草稿", exact: true }).click();
  await expect(page.locator(".document-title")).toContainText("未保存");
  await expect(page.locator(".monaco-source .view-lines")).toContainText(
    "schema_version = 2",
  );
  expect(mdk.openMdkProject(file).contents.schema_version).toBe(1);
  await page.evaluate(() => window.mardikor!.setDirty(false));
  console.log(
    "Recovery after restart passed; original MDK remains valid and untouched.",
  );
} finally {
  await restored.close();
}
