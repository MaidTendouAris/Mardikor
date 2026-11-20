import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { _electron as electron, expect } from "@playwright/test";
import { decodeEnvelope, deriveEnvelopeKey, initEnvelopeCrypto, inspectEnvelope, readEnvelopeHeader } from "../electron/envelope";
import { packMdk, readMdkTextFile } from "../electron/mdk";
import { AppState } from "../electron/state";

const root = path.resolve(".test-artifacts");
await fs.mkdir(root, { recursive: true });
const work = await fs.mkdtemp(path.join(root, "envelope-desktop-"));
const file = path.join(work, "book.mdk");
const capsule = path.join(work, "book.mdke");
const delivery = path.join(work, "delivery.mdk");
const extracted = path.join(work, "extracted.mdk");
const profile = path.join(work, "profile");
packMdk("docs/examples/v2/book", file);
const state = new AppState(profile);
state.preferences({
  ...state.preferences(),
  language: "zh-CN",
  autoCheckUpdates: false,
  autosave: false,
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
});
const page = await app.firstWindow();
page.setDefaultTimeout(20000);
const button = (name: string) =>
  page.getByRole("button", { name, exact: true });
const errors: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));

async function password(title: string, value: string, submit = "确定") {
  await page.getByLabel(title, { exact: true }).fill(value);
  await button(submit).click();
}

async function open(filename: string) {
  await app.evaluate(({ dialog }, selected) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [selected],
    });
  }, filename);
  await button("打开工程").click();
}

async function saveAs(filename: string) {
  await app.evaluate(({ dialog }, selected) => {
    dialog.showSaveDialog = async () => ({
      canceled: false,
      filePath: selected,
    });
  }, filename);
}

try {
  await expect(page.locator(".document-title")).toContainText("markdown/");
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1450, 950));
  await page.locator(".project-tree-row[data-entry-id='node-road']").click();
  await page.getByRole("tab", { name: "源码", exact: true }).click();
  await button("向右拆分编辑器").click();
  const left = page.locator(".editor-group-slot").first();
  const source = left.getByRole("textbox", { name: "源码编辑器", exact: true });
  const initialBytes = await fs.readFile(file);
  const marker = "访问口令设置前的未保存正文";
  await source.focus();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText("\n\n" + marker);
  await expect(page.locator(".document-title")).toContainText("未保存");
  await expect.poll(async () => Boolean(await page.evaluate(
    (name) => window.mardikor!.recovery(name), file,
  ))).toBe(true);

  await button("校验与导出").click();
  await expect(page.getByRole("heading", { name: "校验与导出", exact: true })).toBeVisible();
  await expect(page.locator(".outline-panel")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "主导航" }).getByRole("button", { name: "校验与导出" })).toHaveCount(0);
  assert.deepEqual(await fs.readFile(file), initialBytes);
  await button("返回文稿").click();
  await expect(source).toBeVisible();
  await expect(page.locator(".editor-group-slot")).toHaveCount(2);
  await button("访问保护").click();
  await button("设置访问口令").click();
  await password("新访问口令", " 内层🙂 ");
  await password("确认口令", " 内层🙂 ");
  await expect(button("访问保护")).toHaveAttribute("aria-pressed", "true");
  const firstProtected = await fs.readFile(file);
  assert.equal(inspectEnvelope(firstProtected).kind, "MDKP");
  assert.equal(firstProtected.includes(marker), false);
  await expect(page.locator(".editor-group-slot")).toHaveCount(2);
  await expect(page.locator(".document-title")).toContainText("markdown/road.md");
  await expect(source).toBeVisible();
  await expect.poll(async () => (await fs.readdir(path.join(profile, "recovery"))).length).toBe(0);

  await button("访问保护").click();
  await button("更改访问口令").click();
  await password("新访问口令", " 新口令🙂 ");
  await password("确认口令", " 新口令🙂 ");
  await expect.poll(async () => (await fs.readFile(file)).equals(firstProtected)).toBe(false);
  await expect(page.getByText("访问保护已更新。", { exact: true })).toBeVisible();
  const protectedBytes = await fs.readFile(file);
  await initEnvelopeCrypto();
  const header = readEnvelopeHeader(protectedBytes);
  const old = deriveEnvelopeKey(" 内层🙂 ", header.salt);
  assert.throws(() => decodeEnvelope(protectedBytes, old));
  old.key.fill(0);
  await expect(page.locator(".editor-group-slot")).toHaveCount(2);

  await button("校验与导出").click();
  await button("MDK / MDKE").click();
  await button("校验工程").click();
  await expect(page.getByText("工程校验通过", { exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(work, "editor-delivery.png") });
  await saveAs(delivery);
  await button("导出 .mdk").click();
  await expect(page.getByText("工程已导出。", { exact: true })).toBeVisible();
  assert.equal(inspectEnvelope(await fs.readFile(delivery)).kind, "MDKP");
  assert.deepEqual(await fs.readFile(file), protectedBytes);

  await saveAs(capsule);
  await button("生成 MDKE").click();
  await page.getByRole("combobox", { name: "压缩方式", exact: true }).click();
  await page.getByRole("option", { name: "Zstandard（等级 9）", exact: true }).click();
  await button("设置解包口令").click();
  await password("新解包口令", "外层");
  await password("确认口令", "外层");
  await expect
    .poll(async () => (await fs.stat(capsule).catch(() => null))?.size ?? 0)
    .toBeGreaterThan(144);
  assert.deepEqual(inspectEnvelope(await fs.readFile(capsule)), {
    kind: "MDKE", codec: "zstd", encrypted: true,
  });

  await button("访问保护").click();
  await button("锁定工程").click();
  await expect(page.locator(".document-title")).toHaveCount(0);
  await saveAs(extracted);
  await open(capsule);
  await button("提取并打开").click();
  await button("确定").click();
  await password("解包口令", "外层");
  await expect(page.getByLabel("访问口令", { exact: true })).toBeVisible();
  assert.deepEqual(await fs.readFile(extracted), protectedBytes);
  await password("访问口令", " 新口令🙂 ", "解锁工程");
  await expect(page.locator(".titlebar-caption")).toHaveText("extracted.mdk");
  await expect(button("访问保护")).toHaveAttribute("aria-pressed", "true");
  await button("访问保护").click();
  await button("移除访问保护").click();
  await button("确定").click();
  await expect(button("访问保护")).toHaveAttribute("aria-pressed", "false");
  assert.match(readMdkTextFile(extracted, "markdown/road.md").content, new RegExp(marker));
  assert.deepEqual(errors, []);
} finally {
  await app.close();
}
console.log("Packaged Electron MDKP and MDKE smoke test passed");
