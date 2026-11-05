import { _electron as electron, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import * as mdk from "../electron/mdk";
import { AppState } from "../electron/state";
import { selectOption } from "./select-option.mjs";

const executablePath = process.env.MARDIKOR_TEST_EXECUTABLE;
const root = path.resolve(
  executablePath
    ? ".test-artifacts/markdown-tools-packaged"
    : ".test-artifacts/markdown-tools-desktop",
);
await fs.mkdir(root, { recursive: true });
const userData = await fs.mkdtemp(path.join(root, "profile-"));
new AppState(userData).preferences({
  autosave: false,
  autosaveInterval: 30,
  directorySyncThreshold: 200,
});
const file = path.join(root, `tools-${Date.now()}.mdk`),
  image = path.join(root, "测试图片.png");
await fs.copyFile(path.resolve("assets/icon.png"), image);
mdk.createMdkProject(file, "00");
mdk.saveMdkTextFile(
  file,
  "markdown/001.md",
  "# Markdown 编辑功能\n\n文字\n\n尾段",
);
const env = {
  ...process.env,
  MARDIKOR_USER_DATA: userData,
  MARDIKOR_HEADLESS: "1",
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
let page: Page | undefined;
try {
  page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  // Visual transitions are covered by test:controls; keep command tests deterministic.
  await page.emulateMedia({ reducedMotion: "reduce" });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().forEach((w) => {
      w.webContents.setBackgroundThrottling(false);
      w.setSize(1500, 1000);
    }),
  );
  await expect(page.locator(".document-title")).toContainText(
    "markdown/001.md",
  );
  await page.getByRole("tab", { name: "可视化", exact: true }).click();
  const ribbon = page.getByRole("toolbar", { name: "正文格式", exact: true });
  await page.locator(".document-body p").first().click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  await ribbon.getByRole("button", { name: "加粗", exact: true }).click();
  await expect(page.locator(".document-body p strong")).toHaveText("文字");
  await selectOption(page, page.getByLabel("段落样式", { exact: true }), "6");
  await expect(page.locator(".document-body h6")).toHaveText("文字");
  await page.locator(".document-body h6").click({ button: "right" });
  await expect(
    page.getByRole("menu", { name: "正文右键菜单", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("menuitem", { name: "复制为 Markdown", exact: true })
    .click();
  expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toContain(
    "**文字**",
  );
  // Keep the paste separate from the preceding format operation's 500 ms
  // ProseMirror history group, so this assertion tests undoing just the paste.
  await page.waitForTimeout(550);
  await app.evaluate(({ clipboard }) => clipboard.writeText("粘贴验证"));
  await page.locator(".document-body h6").click({ button: "right" });
  await page.getByRole("menuitem", { name: /^粘贴\s*Ctrl\+V$/ }).click();
  await expect(page.locator(".document-body")).toContainText("粘贴验证");
  await ribbon.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(page.locator(".document-body h6")).toHaveText("文字");
  await page.locator(".document-body p").last().click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  await page.keyboard.press("Control+k");
  const link = page.getByRole("dialog", { name: "链接", exact: true });
  await link
    .getByLabel("链接地址", { exact: true })
    .fill("javascript:alert(1)");
  await link.getByRole("button", { name: "确定", exact: true }).click();
  await expect(link.getByRole("alert")).toContainText("有效");
  await link
    .getByLabel("链接地址", { exact: true })
    .fill("https://example.com/a(1)");
  await link.getByLabel("链接或图片标题", { exact: true }).fill('标题 "引号"');
  await link.getByRole("button", { name: "确定", exact: true }).click();
  await expect(
    page.locator('.document-body a[href="https://example.com/a(1)"]'),
  ).toHaveAttribute("title", '标题 "引号"');
  await app.evaluate(({ dialog }, image) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [image],
    });
  }, image);
  await page.locator(".document-body").press("Control+End");
  await ribbon
    .getByRole("button", { name: "导入本地资源", exact: true })
    .click();
  await expect(page.locator('.toast[role="status"]')).toContainText(
    "已插入 1 个资源",
  );
  await expect(
    page.locator(".document-body img:not(.ProseMirror-separator)"),
  ).toHaveAttribute("src", /^data:image\/png/);
  await page
    .locator(".document-body img:not(.ProseMirror-separator)")
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "编辑图片", exact: true }).click();
  const imageDialog = page.getByRole("dialog", { name: "图片", exact: true });
  await imageDialog
    .getByRole("combobox", { name: "工程图片", exact: true })
    .click();
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(imageDialog).toBeVisible();
  await selectOption(
    page,
    imageDialog.getByRole("combobox", { name: "工程图片", exact: true }),
    "resources/image/测试图片.png",
  );
  await expect(imageDialog.getByLabel("图片地址", { exact: true })).toHaveValue(
    /resources\/image\//,
  );
  await imageDialog.getByRole("button", { name: "确定", exact: true }).click();
  await page.locator(".document-body").press("Control+End");
  await ribbon.getByRole("button", { name: "插入表格", exact: true }).click();
  const tableDialog = page.getByRole("dialog", {
    name: "插入表格",
    exact: true,
  });
  await tableDialog.getByLabel("行数", { exact: true }).fill("3");
  await tableDialog.getByLabel("列数", { exact: true }).fill("2");
  await tableDialog.getByRole("button", { name: "确定", exact: true }).click();
  await expect(page.locator(".document-body tr")).toHaveCount(3);
  await page.locator(".document-body td").first().click();
  await page.keyboard.insertText("a|b");
  await selectOption(
    page,
    page.getByLabel("表格列对齐", { exact: true }),
    "right",
  );
  await expect(page.locator(".document-body th").first()).toHaveAttribute(
    "style",
    /text-align: right/,
  );
  await page
    .getByRole("toolbar", { name: "表格工具", exact: true })
    .getByRole("button", { name: "下方插入行", exact: true })
    .click();
  await expect(page.locator(".document-body tr")).toHaveCount(4);
  await page.locator(".document-body td").first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "删除当前行", exact: true }).click();
  await expect(page.locator(".document-body tr")).toHaveCount(3);
  await page.locator(".document-body td").first().click();
  await page
    .getByRole("toolbar", { name: "表格工具", exact: true })
    .getByRole("button", { name: "右侧插入列", exact: true })
    .click();
  await expect(
    page.locator(".document-body tr").first().locator("th"),
  ).toHaveCount(3);
  console.log(
    "Rich context menu, clipboard, headings, safe link dialog, image import and table operations passed.",
  );
  await page.locator(".document-body").press("Control+End");
  await ribbon.getByRole("button", { name: "代码块", exact: true }).click();
  const code = page.getByRole("dialog", { name: "代码块", exact: true });
  await code.getByLabel("代码语言", { exact: true }).fill("ts");
  await code
    .getByLabel("代码内容", { exact: true })
    .fill("const n = 1\n```embedded```");
  await code.getByRole("button", { name: "确定", exact: true }).click();
  await expect(page.locator(".document-body pre code")).toContainText(
    "```embedded```",
  );
  await page.getByRole("tab", { name: "源码", exact: true }).click();
  let content = mdk.readMdkTextFile(file, "markdown/001.md").content;
  expect(content).toMatch(/###### (?:\[)?\*\*文字\*\*/);
  expect(content).toContain("````ts");
  expect(content).toContain("resources/image/");
  await page.getByRole("textbox", { name: "源码编辑器", exact: true }).focus();
  await expect(page.locator(".monaco-source .view-line").first()).toContainText(
    "Markdown",
  );
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText("\n\n源码文字");
  await expect(page.locator(".monaco-source .view-lines")).toContainText(
    "源码文字",
  );
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Shift+Home");
  await page.keyboard.press("Shift+F10");
  await page.getByRole("menuitem", { name: /Markdown 加粗/ }).click();
  await expect(page.locator(".monaco-source .view-lines")).toContainText(
    "**源码文字**",
  );
  await page.getByRole("textbox", { name: "源码编辑器", exact: true }).focus();
  await expect(
    page.getByRole("menuitem", { name: /Markdown 加粗/ }),
  ).toBeHidden();
  await page.keyboard.press("Shift+F10");
  await page
    .getByRole("menuitem", { name: "插入 Markdown 语法…", exact: true })
    .click();
  const syntax = page.getByRole("dialog", {
    name: "插入 Markdown 语法",
    exact: true,
  });
  await selectOption(
    page,
    syntax.getByLabel("Markdown 语法", { exact: true }),
    "rule",
  );
  await syntax.getByRole("button", { name: "插入", exact: true }).click();
  await page.getByRole("tab", { name: "可视化", exact: true }).click();
  await expect(page.locator(".document-body")).toHaveAttribute(
    "aria-readonly",
    "false",
  );
  await expect(page.locator(".document-body table")).toHaveCount(1);
  if (!executablePath)
    await page.screenshot({ path: path.join(root, "markdown-ribbon.png") });
  await ribbon
    .getByRole("button", { name: "Markdown 语法", exact: true })
    .click();
  const advanced = page.getByRole("dialog", {
    name: "Markdown 语法",
    exact: true,
  });
  await selectOption(
    page,
    advanced.getByLabel("Markdown 语法类型", { exact: true }),
    "reference",
  );
  await advanced
    .getByRole("button", { name: "插入并编辑源码", exact: true })
    .click();
  await expect(
    page.getByRole("tab", { name: "源码", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  const saveButton = page
    .locator(".document-topbar")
    .getByRole("button", { name: /保存/ });
  await expect(page.locator(".document-title")).toContainText("未保存");
  await saveButton.click();
  await expect
    .poll(() => mdk.readMdkTextFile(file, "markdown/001.md").content)
    .toContain("[link-id]:");
  await expect(saveButton).toBeEnabled();
  await page.getByRole("textbox", { name: "源码编辑器", exact: true }).focus();
  await page.keyboard.press("Control+z");
  await expect(page.locator(".document-title")).toContainText("未保存");
  await page
    .locator(".document-topbar")
    .getByRole("button", { name: /保存/ })
    .click();
  await expect
    .poll(() => mdk.readMdkTextFile(file, "markdown/001.md").content)
    .not.toContain("[link-id]:");
  await expect(saveButton).toBeEnabled();
  await page.getByRole("textbox", { name: "源码编辑器", exact: true }).focus();
  await page.keyboard.press("Control+y");
  await expect(page.locator(".document-title")).toContainText("未保存");
  await page
    .locator(".document-topbar")
    .getByRole("button", { name: /保存/ })
    .click();
  await expect
    .poll(() => mdk.readMdkTextFile(file, "markdown/001.md").content)
    .toContain("[link-id]:");
  content = mdk.readMdkTextFile(file, "markdown/001.md").content;
  expect(content).toContain("resources/image/");
  expect(content).toContain("````ts");
  expect(content).toContain("| ");
  expect(mdk.validateMdk(file).valid).toBe(true);
  expect(errors).toEqual([]);
  console.log(
    "Code fence, Monaco context syntax menu, table re-opening and source-only syntax preservation passed.",
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
