import { _electron as electron, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import * as mdk from "../electron/mdk";
import { AppState } from "../electron/state";
import { selectOption } from "./select-option.mjs";
import { markdownHeadings } from "../shared/markdown";
import { pageAtLine, paginateMarkdown } from "../src/services/document-pages";

const root = path.resolve(".test-artifacts/heading-sections");
await fs.mkdir(root, { recursive: true });
const run = await fs.mkdtemp(path.join(root, "run-"));
const profile = path.join(run, "profile");
const pageLength = 2000;
new AppState(profile).preferences({
  autosave: false,
  autosaveInterval: 30,
  directorySyncThreshold: 200,
  pageLength,
  externalOpenView: "preview",
  language: "zh-CN",
});
const env = {
  ...process.env,
  MARDIKOR_USER_DATA: profile,
  MARDIKOR_HEADLESS: "1",
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.VITE_DEV_SERVER_URL;
const executablePath = process.env.MARDIKOR_TEST_EXECUTABLE;
const cover = "# 使用手册\n\n手册正文。\n\n";
const install =
  "## 安装\n\n安装正文。\n\n### 下载安装包\n\n安装包正文。\n\n```md\n# 这是代码中的标题\n```\n\n";
const prepare = "## 准备工作\n\n准备正文。\n\n### 检查环境\n\n环境正文。\n\n";
const faq = "## 常见问题\n\n问题正文。";
const manual = cover + install + prepare + faq;
const reordered = cover + prepare + install + faq;
const typed = " 移动前新增的一句。";
const originalOrder = [
  "H1 使用手册",
  "H2 安装",
  "H3 下载安装包",
  "H2 准备工作",
  "H3 检查环境",
  "H2 常见问题",
];
const movedOrder = [
  "H1 使用手册",
  "H2 准备工作",
  "H3 检查环境",
  "H2 安装",
  "H3 下载安装包",
  "H2 常见问题",
];
const headings = (page: Page) =>
  page
    .getByRole("tree", { name: "文内标题", exact: true })
    .getByRole("treeitem");
const expectOrder = (page: Page, order: string[]) =>
  expect(headings(page)).toHaveText(order.map((name) => name.replace(" ", "")));
const heading = (page: Page, name: string) =>
  page.getByRole("treeitem", { name, exact: true });
const tab = (page: Page, name: string) =>
  page.getByRole("tab", { name, exact: true });
const save = (page: Page) =>
  page
    .locator(".document-topbar")
    .getByRole("button", { name: /保存/ })
    .click();
const outlineMove = (page: Page, name: string) =>
  page.getByRole("button", { name: `移动章节：${name}`, exact: true });
const richBody = (page: Page) =>
  page.locator(".document-body[contenteditable=true]");

async function dragPreparation(
  page: Page,
  destination: string,
  side: "before" | "after",
  hover: () => Promise<void>,
  scrollToEnd = false,
) {
  const source = heading(page, "H2 准备工作");
  const target = heading(page, destination);
  await expect(source).toHaveAttribute("draggable", "true");
  if (!scrollToEnd) await target.scrollIntoViewIfNeeded();
  const from = (await source.boundingBox())!;
  await page.mouse.move(from.x + 75, from.y + from.height / 2);
  await page.mouse.down();
  try {
    await page.mouse.move(from.x + 86, from.y + from.height / 2);
    if (scrollToEnd) {
      await page.locator(".heading-outline-list").evaluate((list) => { list.scrollTop = list.scrollHeight; });
      await target.scrollIntoViewIfNeeded();
    }
    const to = (await target.boundingBox())!;
    const y = to.y + (side === "before" ? 5 : to.height - 5);
    await page.mouse.move(to.x + 75, y, { steps: 4 });
    await page.mouse.move(to.x + 79, y);
    await hover();
  } finally {
    await page.mouse.up();
  }
}

const insertionBefore = (page: Page, title: string) =>
  expect(heading(page, title).locator("..")).toHaveAttribute(
    "data-insert-before",
    "",
  );
const dragPreparationAboveInstallation = (page: Page) =>
  dragPreparation(page, "H2 安装", "before", () =>
    insertionBefore(page, "H2 安装"),
  );

async function useDocument(file: string, check: (page: Page) => Promise<void>) {
  const app = await electron.launch({
    ...(executablePath
      ? { executablePath, args: ["--disable-gpu", file] }
      : { args: [".", file] }),
    env,
    timeout: 30000,
  });
  let page: Page | undefined;
  const errors: string[] = [];
  try {
    page = await app.firstWindow();
    page.setDefaultTimeout(12000);
    page.on("pageerror", (e) => errors.push(e.message));
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().forEach((w) => {
        w.setSize(1500, 1000);
        w.webContents.setBackgroundThrottling(false);
      }),
    );
    await check(page);
    expect(errors).toEqual([]);
  } catch (error) {
    await page
      ?.screenshot({ path: path.join(run, "failure.png") })
      .catch(() => {});
    throw error;
  } finally {
    await page
      ?.evaluate(() => window.mardikor!.setDirty(false))
      .catch(() => {});
    await app.close();
  }
}

const standalone = path.join(run, "manual.md");
const crlf = (value: string) => "\ufeff" + value.replaceAll("\n", "\r\n");
await fs.writeFile(standalone, crlf(manual));
await useDocument(standalone, async (page) => {
  await expectOrder(page, originalOrder);
  await expect(outlineMove(page, "准备工作")).toHaveCount(0);
  await tab(page, "源码").click();
  const source = page.getByRole("textbox", { name: "源码编辑器", exact: true });
  await source.focus();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText(typed);
  const preparation = heading(page, "H2 准备工作");
  await expect(page.locator(".monaco-source .view-lines")).toContainText(
    typed.trim(),
  );
  await dragPreparation(page, "H3 检查环境", "before", async () => {
    await expect(
      page.locator(".heading-outline [data-insert-before]"),
    ).toHaveCount(0);
  });
  await dragPreparation(page, "H2 安装", "before", async () => {
    await insertionBefore(page, "H2 安装");
    await page.keyboard.press("Escape");
  });
  await expectOrder(page, originalOrder);
  await dragPreparationAboveInstallation(page);
  await expectOrder(page, movedOrder);
  await expect(preparation).toHaveAttribute("aria-selected", "true");
  await expect(tab(page, "源码")).toHaveAttribute("aria-selected", "true");
  await expect(source).toBeFocused();
  await expect
    .poll(() =>
      page.evaluate(
        async (file) => (await window.mardikor!.recovery(file))?.text?.content,
        standalone,
      ),
    )
    .toBe(crlf(reordered + typed));
  await page.keyboard.press("Control+z");
  await expectOrder(page, originalOrder);
  await save(page);
  await expect
    .poll(() => fs.readFile(standalone, "utf8"))
    .toBe(crlf(manual + typed));
  await source.focus();
  await page.keyboard.press("Control+z");
  await expect(page.locator(".monaco-source .view-lines")).not.toContainText(
    typed.trim(),
  );
  await page.keyboard.press("Control+y");
  await page.keyboard.press("Control+y");
  await expectOrder(page, movedOrder);
  await dragPreparation(page, "H2 安装", "after", () =>
    insertionBefore(page, "H2 常见问题"),
  );
  await expectOrder(page, originalOrder);
  await page.keyboard.press("Control+z");
  await expectOrder(page, movedOrder);
  await save(page);
  await expect
    .poll(() => fs.readFile(standalone, "utf8"))
    .toBe(crlf(reordered + typed));
});
await useDocument(standalone, async (page) => {
  await expectOrder(page, movedOrder);
  await tab(page, "预览").click();
  await expect(page.locator(".reading-preview pre code")).toContainText(
    "# 这是代码中的标题",
  );
  await expect(page.locator(".reading-preview h1")).toHaveText("使用手册");
  await tab(page, "可视化").click();
  await expect(richBody(page).locator("h1")).toHaveText("使用手册");
});
console.log(
  "Standalone source: mouse drag in both directions, invalid drop, Escape, recovery draft, BOM and CRLF fidelity, undo/redo, save and reopen passed.",
);

await fs.chmod(standalone, 0o444);
try {
  await useDocument(standalone, async (page) => {
    await tab(page, "源码").click();
    const preparation = heading(page, "H2 准备工作");
    await expect(preparation).toHaveAttribute("draggable", "false");
    await expect(outlineMove(page, "准备工作")).toHaveCount(0);
    await preparation.click();
    await expect(preparation).toHaveAttribute("aria-selected", "true");
  });
} finally {
  await fs.chmod(standalone, 0o666);
}

const archive = path.join(run, "manual.mdk");
const other = "# 另一篇\n\n## 独立章节\n\n保持原样。";
mdk.createMdkProject(archive, "00");
mdk.saveMdkTextFile(archive, "markdown/001.md", manual);
mdk.addMdkEntry(archive, "other.md");
mdk.saveMdkTextFile(archive, "markdown/other.md", other);
const sharedDocument =
  mdk.openMdkProject(archive).contents.entries[0].documentId;
expect(sharedDocument).toBeTruthy();
const directory =
  mdk.readMdkTextFile(archive, "contents.toml").content +
  `\n[[nodes]]\nid = "manual-alias"\nkind = "document"\ndocument = ${JSON.stringify(sharedDocument)}\norder = 3\n`;
mdk.saveMdkTextFile(archive, "contents.toml", directory);
const order = mdk.openMdkProject(archive).contents.entries;
expect(order.filter(({ path }) => path === "markdown/001.md")).toHaveLength(2);
await useDocument(archive, async (page) => {
  await tab(page, "可视化").click();
  await expect(richBody(page)).toContainText("问题正文。");
  await page
    .getByRole("button", { name: "向右拆分编辑器", exact: true })
    .first()
    .click();
  const left = page.getByRole("region", { name: "左栏编辑组", exact: true });
  const right = page.getByRole("region", { name: "右栏编辑组", exact: true });
  await right.getByRole("tab", { name: "源码", exact: true }).click();
  const body = left.locator(".document-body");
  await body.focus();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText(typed);
  await expect(body).toContainText(typed.trim());
  const first = outlineMove(page, "安装");
  await first.press("Enter");
  await expect(page.getByRole("menuitem", { name: "上移一节" })).toBeDisabled();
  const down = page.getByRole("menuitem", { name: "下移一节" });
  await expect(down).toBeFocused();
  await down.press("Enter");
  await expectOrder(page, movedOrder);
  await expect(right.locator(".view-lines")).toContainText("## 准备工作");
  await expect(body.locator("h2")).toHaveText(["准备工作", "安装", "常见问题"]);
  await expect(body).toBeFocused();
  await page.keyboard.press("Control+z");
  await expectOrder(page, originalOrder);
  await expect(body).toContainText(typed.trim());
  await page.keyboard.press("Control+z");
  await expect(body).not.toContainText(typed.trim());
  await page.keyboard.press("Control+Shift+z");
  await page.keyboard.press("Control+Shift+z");
  await expectOrder(page, movedOrder);
  await expect(body).toContainText(typed.trim());
  await selectOption(
    page,
    page.getByLabel("右栏文件", { exact: true }),
    "markdown/other.md",
  );
  await expect(right.locator(".reading-preview h1")).toHaveText("另一篇");
  await body.focus();
  await outlineMove(page, "安装").click();
  await page.getByRole("menuitem", { name: "上移一节" }).click();
  await expectOrder(page, originalOrder);
  await expect(right.locator(".reading-preview h1")).toHaveText("另一篇");
  await body.focus();
  await page.keyboard.press("Control+z");
  await expectOrder(page, movedOrder);
  await save(page);
  await expect
    .poll(() => mdk.readMdkTextFile(archive, "markdown/001.md").content)
    .toContain("## 准备工作");
  const stored = mdk.readMdkTextFile(archive, "markdown/001.md").content;
  expect(
    markdownHeadings(stored, true).map((h) => `H${h.level} ${h.title}`),
  ).toEqual(movedOrder);
  expect(stored).toContain(typed.trim());
  expect(mdk.readMdkTextFile(archive, "markdown/other.md").content).toBe(other);
  expect(mdk.openMdkProject(archive).contents.entries).toEqual(order);
  expect(mdk.readMdkTextFile(archive, "contents.toml").content).toBe(directory);
  await dragPreparation(page, "H2 安装", "after", async () => {
    await insertionBefore(page, "H2 常见问题");
    await page
      .locator('.project-tree-row[data-path="markdown/other.md"]')
      .evaluate((row: HTMLElement) => row.click());
    await expect(heading(page, "H1 另一篇")).toBeVisible();
    await expect(
      page.locator(".heading-outline [data-insert-before]"),
    ).toHaveCount(0);
  });
  expect(mdk.readMdkTextFile(archive, "markdown/001.md").content).toBe(stored);
  await page.locator('.project-tree-row[data-path="markdown/001.md"]').first().click();
  await expectOrder(page, movedOrder);
});
console.log(
  "MDK visual: keyboard menu and disabled boundary, prior typing, undo/redo, both split modes and archive save passed.",
);

const paged = path.join(run, "paged.md");
const paragraphs = (name: string) =>
  Array.from(
    { length: 12 },
    (_, i) => `${name} ${i + 1} ${"用于跨页验证的正文。".repeat(34)}\n\n`,
  ).join("");
const pagedInstall = install + paragraphs("第一个章节");
const pagedPrepare = prepare + paragraphs("第二个章节");
const pagedSource = cover + pagedInstall + pagedPrepare + faq;
const pagedMoved = cover + pagedPrepare + pagedInstall + faq;
const chapterPage = (source: string) =>
  pageAtLine(
    paginateMarkdown(source, pageLength).pages,
    markdownHeadings(source).find(({ title }) => title === "准备工作")!.line,
  );
expect(chapterPage(pagedSource)).toBeGreaterThan(chapterPage(pagedMoved) + 1);
await fs.writeFile(paged, pagedSource);
await useDocument(paged, async (page) => {
  await tab(page, "可视化").click();
  await expectOrder(page, originalOrder);
  const title = heading(page, "H2 准备工作");
  await title.click();
  const body = richBody(page);
  await expect(body.locator("h2", { hasText: "准备工作" })).toBeInViewport();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("End");
  await page.keyboard.insertText(typed);
  await expect(body).toContainText(typed.trim());
  await dragPreparationAboveInstallation(page);
  await expectOrder(page, movedOrder);
  await expect(body.locator("h2", { hasText: "准备工作" })).toBeInViewport();
  await expect(body).toBeFocused();
  await page.keyboard.press("Control+z");
  await expectOrder(page, originalOrder);
  await expect(body).toContainText(typed.trim());
  await page.keyboard.press("Control+z");
  await expect(body).not.toContainText(typed.trim());
  await page.keyboard.press("Control+Shift+z");
  await page.keyboard.press("Control+Shift+z");
  await expectOrder(page, movedOrder);
  await save(page);
  await expect
    .poll(async () => (await fs.readFile(paged, "utf8")).replace(typed, ""))
    .toBe(pagedMoved);
  expect(await fs.readFile(paged, "utf8")).toContain(typed.trim());
});
console.log(
  "Paged visual editor: drag across pages, undo/redo through prior typing and exact saved Markdown passed.",
);

const virtual = path.join(run, "virtual.md");
const appendix = Array.from(
  { length: 110 },
  (_, i) => `\n\n## 附录 ${i + 1}\n\n附录正文 ${i + 1}。`,
).join("");
const preamble = "拖动时改动的前言。\n\n";
const state = new AppState(profile);
state.preferences({
  ...state.preferences(),
  autosave: true,
  autosaveInterval: 5,
});
await fs.writeFile(virtual, manual + appendix);
await useDocument(virtual, async (page) => {
  await tab(page, "源码").click();
  await expect(heading(page, "H2 准备工作")).toHaveAttribute(
    "aria-setsize",
    "116",
  );
  expect(await headings(page).count()).toBeLessThan(116);
  await dragPreparation(page, "H2 安装", "before", async () => {
    await insertionBefore(page, "H2 安装");
    const source = page.getByRole("textbox", {
      name: "源码编辑器",
      exact: true,
    });
    await source.focus();
    await page.keyboard.press("Control+Home");
    await page.keyboard.insertText(preamble);
    await expect(page.locator(".monaco-source .view-lines")).toContainText(
      preamble.trim(),
    );
    await expect(
      page.locator(".heading-outline [data-insert-before]"),
    ).toHaveCount(0);
  });
  await expect(heading(page, "H2 准备工作")).toHaveAttribute(
    "aria-posinset",
    "4",
  );
  await dragPreparationAboveInstallation(page);
  await expect(heading(page, "H2 准备工作")).toHaveAttribute(
    "aria-posinset",
    "2",
  );
  await expect
    .poll(() => fs.readFile(virtual, "utf8"), { timeout: 15000 })
    .toBe(preamble + reordered + appendix);
  await dragPreparation(page, "H2 附录 110", "before", () => insertionBefore(page, "H2 附录 110"), true);
  await expect(heading(page, "H2 准备工作")).toHaveAttribute("aria-posinset", "114");
});
console.log(
  "Virtual outline: live edit cancels drag, subsequent drag, autosave and drop beyond the original visible rows passed.",
);
