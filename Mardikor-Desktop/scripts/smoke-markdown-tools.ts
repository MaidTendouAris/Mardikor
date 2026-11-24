import {
  _electron as electron,
  expect,
  type Locator,
  type Page,
} from "@playwright/test";
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
  image = path.join(root, "测试图片.png"),
  audio = path.join(root, "测试声轨 100%#1.m4a");
await fs.copyFile(path.resolve("assets/icon.png"), image);
await fs.writeFile(
  audio,
  Buffer.from("000000186674797069736f6d00000000", "hex"),
);
mdk.createMdkProject(file, "00");
const importedAudio = mdk.importMdkResource(file, audio, "audio").path;
mdk.saveMdkTextFile(
  file,
  "markdown/001.md",
  "# Markdown 编辑功能\n\n文字\n\n尾段",
);
mdk.addMdkEntry(file, "wide.md");
mdk.addMdkEntry(file, "keyboard.md");
mdk.saveMdkTextFile(
  file,
  "markdown/keyboard.md",
  "# 键盘文稿\n\n- [ ] 上层任务\n  - [x] 子任务\n- [ ] 另一项\n\n右栏正文",
);
const tableRow = (cells: string[]) => "| " + cells.join(" | ") + " |";
const tableColumns = Array.from({ length: 16 }, (_, i) => `字段${i + 1}`);
mdk.saveMdkTextFile(
  file,
  "markdown/wide.md",
  [
    "# 宽表格",
    tableRow(tableColumns),
    tableRow(tableColumns.map((_, i) => (i === 1 ? "---:" : "---"))),
    tableRow(
      tableColumns.map((_, i) =>
        i === 15 ? "较长说明".repeat(30) : String(i + 100),
      ),
    ),
  ]
    .join("\n")
    .replace("\n|", "\n\n|") +
    "\n\n" +
    ("分页测试。".repeat(180) + "\n\n").repeat(12),
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
  const palette = page.getByRole("dialog", {
    name: "Markdown 操作",
    exact: true,
  });
  const searchActions = palette.getByRole("combobox", {
    name: "搜索 Markdown 操作",
    exact: true,
  });
  const chooseAction = async (query: string) => {
    await page.keyboard.press("Control+/");
    await expect(searchActions).toBeFocused();
    await page.keyboard.insertText(query);
    await expect(palette.getByRole("option", { selected: true })).toBeVisible();
    await page.keyboard.press("Enter");
  };
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
  await page.locator(".document-body p", { hasText: "尾段" }).click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString()))
    .toBe("尾段");
  await page.keyboard.press("Control+k");
  const link = page.getByRole("dialog", { name: "链接", exact: true });
  await expect(link.getByLabel("链接文字", { exact: true })).toHaveValue(
    "尾段",
  );
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
  await expect(page.locator(".document-body")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Control+k");
  await expect(link.getByLabel("链接地址", { exact: true })).toHaveValue(
    "https://example.com/a(1)",
  );
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText("https://example.com/revised");
  await page.keyboard.press("Enter");
  const revised = page.locator(
    '.document-body a[href="https://example.com/revised"]',
  );
  await expect(revised).toHaveText("尾段");
  await expect(page.locator(".document-body")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Control+Shift+k");
  await expect(link).toHaveCount(0);
  await expect(revised).toHaveCount(0);
  await expect(
    page.locator(".document-body p", { hasText: "尾段" }),
  ).toBeVisible();
  await page.keyboard.press("Control+z");
  await expect(revised).toHaveText("尾段");
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
  const beforeReference = await fs.readFile(file);
  await page.locator(".document-body").press("Control+End");
  await ribbon
    .getByRole("button", { name: "插入包内资源", exact: true })
    .click();
  const assetDialog = page.getByRole("dialog", {
    name: "插入包内资源",
    exact: true,
  });
  await assetDialog
    .getByRole("searchbox", { name: "搜索包内资源" })
    .fill("声轨");
  await selectOption(
    page,
    assetDialog.getByRole("combobox", { name: "包内资源" }),
    importedAudio,
  );
  await assetDialog.getByLabel("链接文字").fill("录音说明");
  await assetDialog.getByRole("button", { name: "插入", exact: true }).click();
  await expect(
    page.locator(".document-body").getByRole("link", { name: "录音说明" }),
  ).toHaveAttribute(
    "href",
    `../resources/audio/${encodeURIComponent(path.basename(audio))}`,
  );
  expect(await fs.readFile(file)).toEqual(beforeReference);
  await page.locator(".document-body").press("Control+End");
  await chooseAction("T");
  const tableDialog = page.getByRole("dialog", {
    name: "插入表格",
    exact: true,
  });
  await expect(tableDialog.getByLabel("行数", { exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(tableDialog.getByLabel("列数", { exact: true })).toBeFocused();
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText("2");
  await page.keyboard.press("Enter");
  await expect(page.locator(".document-body tr")).toHaveCount(3);
  await expect(page.locator(".document-body")).toBeFocused();
  await page.keyboard.insertText("标题一");
  await page.keyboard.press("Tab");
  await page.keyboard.insertText("标题二");
  await expect(page.locator(".document-body th")).toHaveText([
    "标题一",
    "标题二",
  ]);
  await page.keyboard.press("Tab");
  await page.keyboard.insertText("a|b");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.getSelection()?.anchorNode?.parentElement?.closest("td")
            ?.textContent,
      ),
    )
    .toBe("a|b");
  for (let i = 0; i < 4; i++) await page.keyboard.press("Tab");
  await expect(page.locator(".document-body tr")).toHaveCount(4);
  await page.keyboard.press("Control+z");
  await expect(page.locator(".document-body tr")).toHaveCount(3);
  await page.locator(".document-body td").first().click();
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
  const tableTools = page.getByRole("toolbar", {
    name: "表格工具",
    exact: true,
  });
  const toggleTableTools = ribbon.getByRole("button", {
    name: "表格工具",
    exact: true,
  });
  const canvas = page.locator(".document-canvas");
  const canvasBounds = await canvas.boundingBox();
  await expect(tableTools).toBeVisible();
  await expect(tableTools).toHaveCSS("position", "absolute");
  await toggleTableTools.click();
  await expect(tableTools).toBeHidden();
  expect(await canvas.boundingBox()).toEqual(canvasBounds);
  await toggleTableTools.click();
  await expect(tableTools).toBeVisible();
  await page.locator(".document-body > p").first().click();
  await expect(tableTools).toBeHidden();
  await toggleTableTools.click();
  await expect(tableTools).toBeVisible();
  await expect(
    tableTools.getByRole("button", { name: "删除表格" }),
  ).toBeDisabled();
  await toggleTableTools.click();
  await expect(tableTools).toBeHidden();
  await page.locator(".document-body td").first().click();
  await expect(tableTools).toBeVisible();
  expect(await canvas.boundingBox()).toEqual(canvasBounds);
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
  const editedCode = page.locator(".document-body pre code").last();
  await editedCode.click();
  const originalCode = await editedCode.textContent();
  await chooseAction("L");
  const language = page.getByRole("dialog", {
    name: "设置代码块语言",
    exact: true,
  });
  await expect(language.getByLabel("代码语言")).toHaveValue("ts");
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText("python");
  await page.keyboard.press("Enter");
  await expect(editedCode).toHaveClass(/language-python/);
  expect(await editedCode.textContent()).toBe(originalCode);
  await page.getByRole("tab", { name: "源码", exact: true }).click();
  let content = mdk.readMdkTextFile(file, "markdown/001.md").content;
  expect(content).toMatch(/###### (?:\[)?\*\*文字\*\*/);
  expect(content).toContain("````python");
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
    .getByRole("button", { name: "Markdown 操作", exact: true })
    .click();
  await expect(searchActions).toBeFocused();
  await page.keyboard.insertText("reference link");
  await page.keyboard.press("Enter");
  const advanced = page.getByRole("dialog", {
    name: "Markdown 语法",
    exact: true,
  });
  await expect(advanced.locator(".field-hint")).toContainText("切换到源码");
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
  expect(content).toContain("````python");
  expect(content).toContain("| ");
  expect(mdk.validateMdk(file).valid).toBe(true);
  await page.locator('.project-tree-row[data-path="markdown/wide.md"]').click();
  await page.getByRole("tab", { name: "可视化", exact: true }).click();
  const editableTable = page
    .locator(".document-body .mdk-table-container")
    .first();
  const previewTable = page
    .locator(".preview-body .mdk-table-container")
    .first();
  const measureTable = (wrapper: Locator) =>
    wrapper.evaluate((node) => ({
      overflow: getComputedStyle(node).overflowX,
      extra: node.scrollWidth - node.clientWidth,
      columns: Array.from(node.querySelectorAll("tr:first-child th")).map(
        (cell) => ({
          width: Math.round(cell.getBoundingClientRect().width),
          padding: getComputedStyle(cell).paddingInlineStart,
          header: getComputedStyle(cell).backgroundColor,
          align: getComputedStyle(cell).textAlign,
        }),
      ),
    }));
  const editing = await measureTable(editableTable);
  expect(editing.overflow).toBe("auto");
  expect(editing.extra).toBeGreaterThan(0);
  await editableTable.evaluate((node) => {
    node.scrollLeft = 100;
  });
  expect(
    await editableTable.evaluate((node) => node.scrollLeft),
  ).toBeGreaterThan(0);
  await page.getByRole("tab", { name: "预览", exact: true }).click();
  const preview = await measureTable(previewTable);
  expect(preview).toEqual(editing);

  await page.getByRole("button", { name: "应用设置", exact: true }).click();
  const scrollingSettings = page.locator(".app-settings-page");
  await scrollingSettings.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  await expect
    .poll(() =>
      scrollingSettings.evaluate((node) => ({
        scrolled: node.scrollTop > 0,
        flush:
          Math.abs(
            node.getBoundingClientRect().top -
              node.firstElementChild!.getBoundingClientRect().top,
          ) < 1,
      })),
    )
    .toEqual({ scrolled: true, flush: true });
  const tableScroll = page.getByRole("switch", {
    name: "允许表格横向滚动",
    exact: true,
  });
  await expect(tableScroll).toBeChecked();
  await tableScroll.uncheck();
  await page.getByRole("button", { name: "保存偏好", exact: true }).click();
  await expect
    .poll(() => new AppState(userData).preferences().allowTableHorizontalScroll)
    .toBe(false);
  await page.getByRole("button", { name: "编辑器", exact: true }).click();
  for (const [name, wrapper] of [
    ["预览", previewTable],
    ["可视化", editableTable],
  ] as const) {
    await page.getByRole("tab", { name, exact: true }).click();
    const fitted = await measureTable(wrapper);
    expect(fitted.overflow).toBe("clip");
    expect(fitted.extra).toBe(0);
  }
  console.log(
    "Matching edit and preview tables, floating controls, table scrolling preference and sticky settings header passed.",
  );
  await page
    .getByRole("button", { name: "向右拆分编辑器", exact: true })
    .first()
    .click();
  const right = page.getByRole("region", { name: "右栏编辑组", exact: true });
  await selectOption(
    page,
    page.getByLabel("右栏文件", { exact: true }),
    "markdown/keyboard.md",
  );
  await right.getByRole("tab", { name: "可视化", exact: true }).click();
  const rightBody = right.locator(".document-body");
  const rightTasks = rightBody.locator("li[data-checked]");
  const checked = () =>
    rightTasks.evaluateAll((rows) =>
      rows.map((row) => row.getAttribute("data-checked")),
    );
  const selectTask = async () => {
    await rightBody.getByText("上层任务", { exact: true }).click();
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+End");
  };
  await selectTask();
  await page.keyboard.press("Control+/");
  await expect(searchActions).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(rightBody).toBeFocused();
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString()))
    .toBe("上层任务");
  await chooseAction("X");
  await expect.poll(checked).toEqual(["true", "true", "false"]);
  await expect(rightBody).toBeFocused();
  await page.keyboard.press("Control+z");
  await expect.poll(checked).toEqual(["false", "true", "false"]);
  await selectTask();
  await chooseAction("勾选");
  await expect.poll(checked).toEqual(["true", "true", "false"]);
  const beforeLeft = mdk.readMdkTextFile(file, "markdown/wide.md").content;
  await page.keyboard.press("Control+s");
  await expect
    .poll(() => mdk.readMdkTextFile(file, "markdown/keyboard.md").content)
    .toContain("- [x] 上层任务\n  - [x] 子任务\n- [ ] 另一项");
  expect(mdk.readMdkTextFile(file, "markdown/wide.md").content).toBe(
    beforeLeft,
  );
  await rightBody.getByText("右栏正文", { exact: true }).click();
  await page.keyboard.press("Control+Shift+9");
  await expect(rightTasks).toHaveCount(4);
  await page.keyboard.press("Control+Shift+9");
  await expect(rightTasks).toHaveCount(3);
  await page.keyboard.press("Control+Shift+7");
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.insertText("第二项");
  await page.keyboard.press("Tab");
  await expect(rightBody.locator("ol ol li")).toHaveText("第二项");
  await page.keyboard.press("Shift+Tab");
  await expect(rightBody.locator("ol > li")).toHaveCount(2);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.insertText("正文行一");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.insertText("正文行二");
  await expect(
    rightBody.locator(":scope > p", { hasText: "正文行二" }).locator("br"),
  ).toHaveCount(1);
  console.log(
    "Keyboard link editing, table navigation, code language and split task completion passed.",
  );
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
