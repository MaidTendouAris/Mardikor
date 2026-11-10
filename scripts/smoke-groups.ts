import {
  _electron as electron,
  expect,
  type Page,
  type Locator,
} from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import * as mdk from "../electron/mdk";
import { AppState } from "../electron/state";
import { selectOption } from "./select-option.mjs";

const executablePath = process.env.MARDIKOR_TEST_EXECUTABLE;
const root = path.resolve(
  executablePath
    ? ".test-artifacts/groups-packaged"
    : ".test-artifacts/groups-desktop",
);
await fs.mkdir(root, { recursive: true });
const userData = await fs.mkdtemp(path.join(root, "profile-"));
const file = path.join(root, `groups-${Date.now()}.mdk`);
new AppState(userData).preferences({
  autosave: false,
  autosaveInterval: 30,
  directorySyncThreshold: 200,
});
const text = (name: string, count: number) =>
  `# ${name}\n\n` +
  Array.from(
    { length: count },
    (_, i) =>
      `## 第 ${i + 1} 节\n\n${name}的第 ${i + 1} 段正文，检查双栏阅读进度。`,
  ).join("\n\n");
mdk.createMdkProject(file, "00");
mdk.saveMdkTextFile(file, "markdown/001.md", text("左侧文稿", 100));
mdk.addMdkEntry(file, "second.md");
mdk.saveMdkTextFile(file, "markdown/second.md", text("右侧文稿", 65));
const env = {
  ...process.env,
  MARDIKOR_USER_DATA: userData,
  MARDIKOR_HEADLESS: "1",
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.VITE_DEV_SERVER_URL;
const launch = () =>
  electron.launch({
    ...(executablePath
      ? { executablePath, args: ["--disable-gpu", file] }
      : { args: [".", file] }),
    env,
    timeout: 30000,
  });
const errors: string[] = [];
async function prepare(page: Page) {
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => errors.push(e.message));
}
async function append(page: Page, pane: Locator, value: string) {
  await pane.getByRole("textbox", { name: "源码编辑器", exact: true }).focus();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText("\n\n" + value);
}
async function ratio(pane: Locator, type = "source") {
  if (type !== "source")
    return pane
      .locator(type === "preview" ? ".reading-preview" : ".document-canvas")
      .evaluate(
        (node) =>
          node.scrollTop / Math.max(1, node.scrollHeight - node.clientHeight),
      );
  return pane
    .locator(".monaco-source .scrollbar.vertical .slider")
    .first()
    .evaluate((node) => {
      const slider = node as HTMLElement,
        bar = slider.parentElement!;
      return (
        parseFloat(slider.style.top || "0") /
        Math.max(1, bar.clientHeight - slider.clientHeight)
      );
    });
}
async function wheel(
  page: Page,
  pane: Locator,
  delta: number,
  type = "source",
) {
  const box = await pane
    .locator(
      type === "source"
        ? ".monaco-source"
        : type === "preview"
          ? ".reading-preview"
          : ".document-canvas",
    )
    .boundingBox();
  await page.mouse.move(box!.x + box!.width * 0.6, box!.y + box!.height * 0.5);
  // Electron on Windows normalizes each injected wheel event to a notch.
  for (let i = 0; i < Math.max(1, Math.round(Math.abs(delta) / 60)); i++)
    await page.mouse.wheel(0, Math.sign(delta) * 120);
}
async function synced(left: Locator, right: Locator, rightType = "source") {
  await expect
    .poll(async () =>
      Math.abs((await ratio(left)) - (await ratio(right, rightType))),
    )
    .toBeLessThan(0.04);
}
let app = await launch(),
  page: Page | undefined;
try {
  page = await app.firstWindow();
  await prepare(page);
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().forEach((w) => {
      w.webContents.setBackgroundThrottling(false);
      w.setSize(1560, 1000);
    }),
  );
  await expect(page.locator(".document-title")).toContainText(
    "markdown/001.md",
  );
  const tree = page.getByRole("tree", { name: "文稿目录树", exact: true });
  await page.getByRole("tab", { name: "可视化", exact: true }).click();
  await tree.locator('[data-path="markdown/second.md"]').click();
  await expect(page.locator(".document-title")).toContainText(
    "markdown/second.md",
  );
  await expect(
    page.getByRole("tab", { name: "预览", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".reading-preview h1")).toHaveText("右侧文稿");
  await page.getByRole("tab", { name: "源码", exact: true }).click();
  await tree.locator('[data-path="markdown/001.md"]').click();
  await expect(page.locator(".document-title")).toContainText(
    "markdown/001.md",
  );
  await expect(
    page.getByRole("tab", { name: "预览", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".reading-preview h1")).toHaveText("左侧文稿");
  await page.getByRole("tab", { name: "源码", exact: true }).click();
  const separator = page.getByRole("separator", {
    name: "调整文稿目录与标题大纲高度",
    exact: true,
  });
  await expect(separator).toHaveAttribute("aria-valuenow", "50");
  let top = await page.locator(".directory-section").boundingBox(),
    bottom = await page.locator(".heading-outline").boundingBox();
  expect(Math.abs(top!.height - bottom!.height)).toBeLessThan(2);
  const handle = (await separator.boundingBox())!;
  await page.mouse.move(handle.x + 40, handle.y + 3);
  await page.mouse.down();
  await page.mouse.move(handle.x + 40, handle.y + 100, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(async () => Number(await separator.getAttribute("aria-valuenow")))
    .toBeGreaterThan(60);
  await separator.press("Enter");
  await expect(separator).toHaveAttribute("aria-valuenow", "50");
  await page
    .getByRole("button", { name: "向右拆分编辑器", exact: true })
    .click();
  const left = page.getByRole("region", { name: "左栏编辑组", exact: true }),
    right = page.getByRole("region", { name: "右栏编辑组", exact: true });
  await expect(page.locator(".editor-group")).toHaveCount(2);
  expect(
    Math.abs(
      (await left.boundingBox())!.width - (await right.boundingBox())!.width,
    ),
  ).toBeLessThan(2);
  await right.getByRole("tab", { name: "可视化", exact: true }).click();
  await selectOption(
    page,
    page.getByLabel("右栏文件", { exact: true }),
    "markdown/second.md",
  );
  await expect(
    right.getByRole("tab", { name: "预览", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(right.locator(".reading-preview h1")).toHaveText("右侧文稿");
  await expect(
    left.getByRole("tab", { name: "源码", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await right.getByRole("tab", { name: "源码", exact: true }).click();
  await expect(page.getByLabel("左栏文件", { exact: true })).toHaveAttribute(
    "data-value",
    "markdown/001.md",
  );
  await append(page, right, "右栏独立修改");
  await append(page, left, "左栏独立修改");
  await page
    .locator(".document-topbar")
    .getByRole("button", { name: /保存/ })
    .click();
  await expect
    .poll(() => mdk.readMdkTextFile(file, "markdown/001.md").content)
    .toContain("左栏独立修改");
  expect(mdk.readMdkTextFile(file, "markdown/second.md").content).toContain(
    "右栏独立修改",
  );
  expect(mdk.readMdkTextFile(file, "markdown/001.md").content).not.toContain(
    "右栏独立修改",
  );
  console.log(
    "Independent editor groups, atomic save and equal/resizable sidebar panels passed.",
  );
  await selectOption(
    page,
    page.getByLabel("右栏文件", { exact: true }),
    "markdown/001.md",
  );
  await right.getByRole("tab", { name: "源码", exact: true }).click();
  await append(page, left, "共享修改与撤销");
  await expect(right.locator(".view-lines")).toContainText("共享修改与撤销");
  await right.getByRole("textbox", { name: "源码编辑器", exact: true }).focus();
  await page.keyboard.press("Control+z");
  await expect(left.locator(".view-lines")).not.toContainText("共享修改与撤销");
  await expect(right.locator(".view-lines")).not.toContainText(
    "共享修改与撤销",
  );
  await left.getByRole("textbox", { name: "源码编辑器", exact: true }).focus();
  await page.keyboard.press("Control+Home");
  await wheel(page, left, 1500);
  await expect.poll(() => ratio(left)).toBeGreaterThan(0.1);
  await synced(left, right);
  const previous = await ratio(left);
  await wheel(page, right, -600);
  await expect.poll(() => ratio(left)).toBeLessThan(previous - 0.01);
  await synced(left, right);
  await right.getByRole("tab", { name: "预览", exact: true }).click();
  await synced(left, right, "preview");
  await wheel(page, right, 1400, "preview");
  await synced(left, right, "preview");
  const beforeVisual = await ratio(left);
  await right.getByRole("tab", { name: "可视化", exact: true }).click();
  await synced(left, right, "write");
  await wheel(page, right, -500, "write");
  await expect.poll(() => ratio(left)).toBeLessThan(beforeVisual);
  await synced(left, right, "write");
  await append(page, left, "## 双栏实时标题");
  await expect(right.locator(".document-body")).toContainText("双栏实时标题");
  await expect(
    page.getByRole("treeitem", { name: "H2 双栏实时标题", exact: true }),
  ).toBeVisible();
  const widthSeparator = page.getByRole("separator", {
    name: "调整左右编辑组宽度",
    exact: true,
  });
  const width = (await left.boundingBox())!.width,
    widthHandle = (await widthSeparator.boundingBox())!;
  await page.mouse.move(widthHandle.x + 3, widthHandle.y + 150);
  await page.mouse.down();
  await page.mouse.move(widthHandle.x + 110, widthHandle.y + 150, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(async () => (await left.boundingBox())!.width)
    .toBeGreaterThan(width + 70);
  await widthSeparator.press("Enter");
  if (!executablePath)
    await page.screenshot({ path: path.join(root, "split-editors.png") });
  console.log(
    "Shared Monaco editing/undo and bidirectional source, preview and visual scrolling passed.",
  );
  await selectOption(
    page,
    page.getByLabel("右栏文件", { exact: true }),
    "markdown/second.md",
  );
  await right.getByRole("tab", { name: "源码", exact: true }).click();
  await right.getByRole("textbox", { name: "源码编辑器", exact: true }).focus();
  await page.keyboard.press("Control+End");
  await expect.poll(() => ratio(left)).toBeGreaterThan(0.95);
  await synced(left, right);
  await page
    .getByRole("button", { name: "操作 second.md", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "重命名", exact: true }).click();
  await page
    .getByRole("textbox", { name: "重命名文稿", exact: true })
    .fill("renamed.md");
  await page
    .getByRole("button", { name: "重命名", exact: true })
    .last()
    .click();
  await expect(page.getByLabel("右栏文件", { exact: true })).toHaveAttribute(
    "data-value",
    "markdown/renamed.md",
  );
  await expect(page.getByLabel("左栏文件", { exact: true })).toHaveAttribute(
    "data-value",
    "markdown/001.md",
  );
  await page.getByRole("button", { name: "关闭右栏", exact: true }).click();
  await page
    .getByRole("button", { name: "操作 renamed.md", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "在旁侧打开", exact: true }).click();
  await expect(page.getByLabel("右栏文件", { exact: true })).toHaveAttribute(
    "data-value",
    "markdown/renamed.md",
  );
  await right.getByRole("tab", { name: "源码", exact: true }).click();
  await append(page, left, "左栏恢复草稿");
  await append(page, right, "右栏恢复草稿");
  await expect
    .poll(() =>
      page!.evaluate(
        async (file) => (await window.mardikor!.recovery(file))?.texts?.length,
        file,
      ),
    )
    .toBe(2);
  expect(mdk.readMdkTextFile(file, "markdown/001.md").content).not.toContain(
    "左栏恢复草稿",
  );
  expect(
    mdk.readMdkTextFile(file, "markdown/renamed.md").content,
  ).not.toContain("右栏恢复草稿");
  await page.evaluate(() => window.mardikor!.setDirty(false));
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  await prepare(page);
  await page.getByRole("button", { name: "恢复草稿", exact: true }).click();
  await expect(page.locator(".editor-group")).toHaveCount(2);
  await page
    .locator(".document-topbar")
    .getByRole("button", { name: /保存/ })
    .click();
  await expect
    .poll(() => mdk.readMdkTextFile(file, "markdown/001.md").content)
    .toContain("左栏恢复草稿");
  expect(mdk.readMdkTextFile(file, "markdown/renamed.md").content).toContain(
    "右栏恢复草稿",
  );
  expect(errors).toEqual([]);
  console.log(
    "Different-document scrolling, rename reconciliation, open-to-side and both-buffer recovery passed.",
  );
} catch (error) {
  if (page && !executablePath)
    await page
      .screenshot({ path: path.join(root, "failure.png") })
      .catch(() => {});
  console.error(await page?.locator(".toast").allTextContents());
  throw error;
} finally {
  await page?.evaluate(() => window.mardikor!.setDirty(false)).catch(() => {});
  await app.close();
}
