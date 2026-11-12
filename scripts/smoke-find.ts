import {
  _electron as electron,
  expect,
  type Locator,
  type Page,
} from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { AppState } from "../electron/state";
import * as mdk from "../electron/mdk";

const root = path.resolve(".test-artifacts/find");
await fs.mkdir(root, { recursive: true });
const run = await fs.mkdtemp(path.join(root, "source-"));
const profile = path.join(run, "profile");
const markdown = path.join(run, "long.md");
const book = path.join(run, "find-book.mdk");
const text =
  "# 查找\n\n[安装指南](https://example.com/Case)\n\n同词 **同词**\n\n" +
  "## 小节\n\n长文稿正文。\n\n".repeat(6000) +
  "末尾 [case](https://example.net/last)\n";
const state = new AppState(profile);
state.preferences({
  ...state.preferences(),
  autosave: false,
  language: "zh-CN",
  pageLength: 2000,
});
await fs.writeFile(markdown, text);

const first = "markdown/001.md";
mdk.createMdkProject(book, "01");
mdk.saveMdkTextFile(book, first, "# 第一章\n\n层级命中。双标记 **双标记**。\n");
mdk.applyMdkBatch(book, mdk.fileRevision(book), {
  writes: [],
  positions: [],
  newEntries: [
    {
      path: "markdown/child.md",
      position: "1.1",
      markdown: "# 子章\n\n层级命中。",
    },
    {
      path: "markdown/grandchild.md",
      position: "1.1.1",
      markdown: "# 孙章\n\n层级命中。",
    },
    {
      path: "markdown/other.md",
      position: "2",
      markdown: "# 另一章\n\n层级命中。",
    },
  ],
});
const revision = mdk.fileRevision(book);
const env = {
  ...process.env,
  MARDIKOR_HEADLESS: "offscreen",
  MARDIKOR_USER_DATA: profile,
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.VITE_DEV_SERVER_URL;
const executablePath = process.env.MARDIKOR_TEST_EXECUTABLE;
const app = await electron.launch({
  ...(executablePath
    ? { executablePath, args: ["--disable-gpu", markdown, book] }
    : { args: [".", markdown, book] }),
  env,
  timeout: 30000,
});
const shortcut = process.platform === "darwin" ? "Meta+f" : "Control+f";
const errors: string[] = [];
async function windowFor(file: string) {
  let found: Page | undefined;
  await expect
    .poll(
      async () => {
        for (const page of app.windows()) {
          if (
            (
              await page.locator(".titlebar-caption").allTextContents()
            ).includes(path.basename(file))
          ) {
            found = page;
            return true;
          }
        }
        return false;
      },
      { timeout: 30000 },
    )
    .toBe(true);
  found!.setDefaultTimeout(15000);
  found!.on("pageerror", (error) => errors.push(error.message));
  return found!;
}

const pane = (page: Page, n = 0) => page.locator(".editor-group").nth(n);
const bar = (group: Locator) => group.getByRole("search", { name: "文档查找" });
const query = (group: Locator) =>
  bar(group).getByRole("textbox", { name: "查找文字" });
const source = (group: Locator) =>
  group.getByRole("textbox", { name: "源码编辑器", exact: true });
const current = (group: Locator) =>
  group.locator(".monaco-editor .document-find-current").first();
const status = (group: Locator) => bar(group).getByRole("status");
const tab = (group: Locator, name: string) =>
  group.getByRole("tab", { name, exact: true });
const button = (group: Locator) =>
  group.getByRole("button", { name: "查找", exact: true });
const settings = (group: Locator) =>
  bar(group).getByRole("button", { name: "查找设置" });
const close = (group: Locator) =>
  bar(group).getByRole("button", { name: "关闭查找" });
const jumpNumber = (group: Locator) =>
  bar(group).getByRole("textbox", { name: "跳转到匹配项" });
async function renderedMatch(group: Locator, expected: string, active = true) {
  const name = active
    ? "mardikor-document-find"
    : "mardikor-document-find-matches";
  await expect
    .poll(() =>
      group.evaluate(
        (element, name) =>
          [...(CSS.highlights.get(name) ?? [])]
            .filter((range) => element.contains(range.startContainer))
            .map((range) => range.toString())
            .join(""),
        name,
      ),
    )
    .toBe(expected);
}
async function search(group: Locator, value: string, count: string) {
  await query(group).fill(value);
  await expect(status(group)).toHaveText(count);
}

try {
  const page = await windowFor(markdown);
  const single = pane(page);
  await tab(single, "预览").click();
  const canvas = single.locator(".document-canvas");
  const bounds = await canvas.boundingBox();
  await button(single).click();
  await expect(query(single)).toBeFocused();
  await expect(status(single)).toBeEmpty();
  await search(single, "case", "0 / 2");
  await renderedMatch(single, "安装指南", false);
  const queryBox = (await query(single).boundingBox())!;
  const jumpBox = (await jumpNumber(single).boundingBox())!;
  expect(jumpBox.height).toBe(queryBox.height);
  expect(jumpBox.y).toBe(queryBox.y);
  expect(jumpBox.width).toBeLessThan(queryBox.width);
  await settings(single).click();
  expect(await canvas.boundingBox()).toEqual(bounds);
  await bar(single).getByRole("checkbox", { name: "区分大小写" }).check();
  await expect(status(single)).toHaveText("0 / 1");
  await bar(single).getByRole("checkbox", { name: "区分大小写" }).uncheck();
  await query(single).press("Escape");
  await expect(settings(single)).toHaveAttribute("aria-expanded", "false");
  await expect(tab(single, "预览")).toHaveAttribute("aria-selected", "true");
  await query(single).press("Shift+Enter");
  await expect(tab(single, "预览")).toHaveAttribute("aria-selected", "true");
  await renderedMatch(single, "case");
  await renderedMatch(single, "case", false);
  await expect(status(single)).toHaveText("2 / 2");
  await jumpNumber(single).fill("1");
  await jumpNumber(single).press("Enter");
  await renderedMatch(single, "安装指南");
  await expect(status(single)).toHaveText("1 / 2");
  await expect(jumpNumber(single)).toBeFocused();
  await jumpNumber(single).press("Escape");
  await expect(bar(single)).toHaveCount(0);
  await renderedMatch(single, "");
  await renderedMatch(single, "", false);
  await tab(single, "可视化").click();
  await button(single).click();
  await search(single, "同词", "0 / 2");
  await renderedMatch(single, "同词同词", false);
  await query(single).press("Enter");
  await renderedMatch(single, "同词");
  await renderedMatch(single, "同词同词", false);
  await search(single, "case", "0 / 2");
  await jumpNumber(single).fill("2");
  await jumpNumber(single).press("Enter");
  await expect(tab(single, "可视化")).toHaveAttribute("aria-selected", "true");
  await renderedMatch(single, "case");
  await expect(
    single.locator(".document-body[contenteditable=true]"),
  ).toContainText("末尾");
  await close(single).click();
  await tab(single, "源码").click();
  await source(single).focus();
  await page.keyboard.press("Control+Home");
  await button(single).click();
  await search(single, "同词", "0 / 2");
  const sourceMarks = single.locator(".monaco-editor .document-find-match");
  await expect(sourceMarks).toHaveCount(2);
  await expect(current(single)).toHaveCount(0);
  await query(single).press("Enter");
  await expect(current(single)).toHaveText("同词");
  await expect(sourceMarks).toHaveCount(2);
  expect(
    await current(single).evaluate(
      (node) => getComputedStyle(node).backgroundColor,
    ),
  ).not.toBe(
    await sourceMarks
      .last()
      .evaluate((node) => getComputedStyle(node).backgroundColor),
  );
  await search(single, "小节", "0 / 6000");
  await expect(sourceMarks.first()).toHaveText("小节");
  await jumpNumber(single).fill("6000");
  await jumpNumber(single).press("Enter");
  await expect(current(single)).toHaveText("小节");
  await expect(sourceMarks.last()).toHaveText("小节");
  await close(single).click();
  await expect(sourceMarks).toHaveCount(0);
  await source(single).focus();

  await page.keyboard.press("Control+End");
  await page.keyboard.insertText("\n未保存OnlyInDraft\n");
  await single.getByRole("button", { name: "切换源码与预览分栏" }).click();
  await page.keyboard.press(shortcut);
  await expect(query(single)).toBeFocused();
  await expect(
    single.locator(".monaco-editor .find-widget.visible"),
  ).toHaveCount(0);
  await query(single).fill("never a match");
  await search(single, "OnlyInDraft", "0 / 1");
  await query(single).evaluate((element) =>
    element.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    ),
  );
  await query(single).press("Enter");
  await expect(current(single)).toHaveCount(0);
  await query(single).evaluate((element) =>
    element.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true }),
    ),
  );
  await expect(status(single)).toHaveText("0 / 1");
  await query(single).press("Enter");
  await expect(current(single)).toHaveText("OnlyInDraft");
  await renderedMatch(single, "OnlyInDraft");
  await expect(page.locator(".editor-statusbar")).toContainText("未保存");
  expect(await fs.readFile(markdown, "utf8")).toBe(text);

  const bookPage = await windowFor(book);
  const left = pane(bookPage);
  await tab(left, "阅读").click();
  await expect(left.locator(".reader-markdown").first()).toBeVisible();
  await button(left).click();
  await search(left, "双标记", "0 / 2");
  await renderedMatch(left, "双标记双标记", false);
  await query(left).press("Enter");
  await renderedMatch(left, "双标记");
  await search(left, "层级命中", "0 / 1");
  await settings(left).click();
  const branchScope = bar(left).getByRole("radio", {
    name: "当前文档及其子文档",
  });
  await branchScope.check();
  await expect(branchScope).toHaveCSS("height", "14px");
  await expect(branchScope).toHaveCSS("width", "14px");
  await expect(branchScope).toHaveCSS("outline-style", "none");
  await settings(left).focus();
  await bookPage.keyboard.press("Tab");
  await expect(branchScope).toBeFocused();
  await expect(branchScope.locator("..")).toHaveCSS("outline-style", "solid");
  await expect(status(left)).toHaveText("0 / 3");
  const directory = bookPage.getByRole("tree", { name: "文稿目录树" });
  const outline = bookPage.getByRole("tree", { name: "文内标题" });
  await expect(directory.locator("[data-find-match]")).toHaveCount(3);
  await query(left).press("Escape");
  await expect(tab(left, "阅读")).toHaveAttribute("aria-selected", "true");
  await query(left).press("Enter");
  await renderedMatch(left, "层级命中");
  await query(left).press("Enter");
  await expect(
    left.locator(".reader-manuscript[data-source-path='markdown/child.md']"),
  ).toBeVisible();
  await renderedMatch(left, "层级命中");
  await expect(directory.locator("[data-find-current]")).toHaveAttribute(
    "data-path",
    "markdown/child.md",
  );
  await expect(outline.locator("[data-find-current]")).toContainText("子章");
  await expect(status(left)).toHaveText("2 / 3");
  await query(left).press("Enter");
  await expect(
    left.locator(
      ".reader-manuscript[data-source-path='markdown/grandchild.md']",
    ),
  ).toBeVisible();
  await expect(status(left)).toHaveText("3 / 3");
  await settings(left).click();
  await bar(left).getByRole("radio", { name: "全部文档" }).check();
  await expect(status(left)).toHaveText("0 / 4");
  await expect(directory.locator("[data-find-match]")).toHaveCount(4);
  await query(left).press("Escape");
  await query(left).press("Shift+Enter");
  await expect(
    left.locator(".reader-manuscript[data-source-path='markdown/other.md']"),
  ).toBeVisible();
  await renderedMatch(left, "层级命中");
  await expect(tab(left, "阅读")).toHaveAttribute("aria-selected", "true");
  await close(left).click();
  await expect(directory.locator("[data-find-match]")).toHaveCount(0);
  await expect(outline.locator("[data-find-match]")).toHaveCount(0);
  await tab(left, "预览").click();
  await button(left).click();
  await search(left, "层级命中", "0 / 4");
  await renderedMatch(left, "层级命中".repeat(4), false);
  await renderedMatch(left, "");
  await close(left).click();

  await tab(left, "可视化").click();
  await expect(
    left.locator(".document-body[contenteditable=true]"),
  ).toBeVisible();
  await button(left).click();
  await search(left, "另一章", "0 / 1");
  await query(left).press("Enter");
  await expect(tab(left, "可视化")).toHaveAttribute("aria-selected", "true");
  await renderedMatch(left, "另一章");
  await search(left, "不存在", "0 / 0");
  await bookPage
    .getByRole("button", { name: "向右拆分编辑器", exact: true })
    .click();
  const right = pane(bookPage, 1);
  await tab(right, "源码").click();
  await button(right).click();
  await search(right, "另一章", "0 / 1");
  await expect(query(left)).toHaveValue("不存在");
  await query(right).press("Enter");
  await expect(current(right)).toHaveText("另一章");
  await expect(current(left)).toHaveCount(0);
  expect(mdk.fileRevision(book)).toBe(revision);
  expect(errors).toEqual([]);
  console.log("Unified source find smoke test passed");
} finally {
  for (const page of app.windows())
    await page.evaluate(() => window.mardikor!.setDirty(false)).catch(() => {});
  await app.close();
}
