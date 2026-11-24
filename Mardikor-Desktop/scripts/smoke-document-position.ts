import { _electron as electron, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { AppState } from "../electron/state";
import {
  addMdkEntry,
  createMdkProject,
  readMdkTextFile,
  saveMdkTextFile,
} from "../electron/mdk";

const root = path.resolve(".test-artifacts");
await fs.mkdir(root, { recursive: true });
const directory = await fs.mkdtemp(path.join(root, "document-position-"));
const profile = path.join(directory, "profile");
const state = new AppState(profile);
state.preferences({
  ...state.preferences(),
  language: "zh-CN",
  autoCheckUpdates: false,
  autosave: false,
});
state.windowSize({ width: 1500, height: 930, maximized: false });
const file = path.join(directory, "resume.mdk");
const first = "markdown/001.md";
const second = "markdown/second.md";
const firstText = "# First\n\n初😀\n";
const secondText =
  "# Second\n\n" +
  Array.from(
    { length: 120 },
    (_, i) => `段落 ${i + 1} ${"连续内容 ".repeat(14)}`,
  ).join("\n\n");
createMdkProject(file, "01");
addMdkEntry(file, "second.md");
saveMdkTextFile(file, first, firstText);
saveMdkTextFile(file, second, secondText);
saveMdkTextFile(file, "markdown/detached.md", "已登记");
saveMdkTextFile(file, "markdown/unlisted.md", "未登记".repeat(400));
saveMdkTextFile(
  file,
  "contents.toml",
  readMdkTextFile(file, "contents.toml").content +
    '\n[[documents]]\nid = "detached"\npath = "markdown/detached.md"\n',
);
saveMdkTextFile(
  file,
  "settings.toml",
  "[reading]\nchapter_numbering = false\nshow_toc = true\n\n[preview]\nmax_width = 1280.0\n",
);
const initialBytes = await fs.readFile(file);
const total = (
  Array.from(firstText).length +
  Array.from(secondText).length +
  3
).toLocaleString("zh-CN");
const sourceColumn = secondText.split("\n").at(-1)!.length + 1;

const executablePath = process.env.MARDIKOR_TEST_EXECUTABLE;
const env = {
  ...process.env,
  MARDIKOR_USER_DATA: profile,
  MARDIKOR_HEADLESS: "offscreen",
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.VITE_DEV_SERVER_URL;
const tab = (page: Page, name: string) =>
  page.getByRole("tab", { name, exact: true });
const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });
const resume = (page: Page) => button(page, "从上次关闭的位置开始");
const title = (page: Page) => page.locator(".document-title");
const status = (page: Page) => page.locator(".editor-statusbar");
const saved = () => new AppState(profile).documentPosition(file);

async function session(run: (page: Page) => Promise<void>) {
  const app = await electron.launch({
    ...(executablePath
      ? { executablePath, args: [file] }
      : { args: [".", file] }),
    env,
  });
  let page: Page | undefined;
  try {
    page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    await expect(title(page)).toContainText(first);
    await expect(tab(page, "预览")).toHaveAttribute("aria-selected", "true");
    await run(page);
  } finally {
    await page
      ?.evaluate(() => window.mardikor?.setDirty(false))
      .catch(() => {});
    await app.close();
  }
}

await session(async (page) => {
  await expect(resume(page)).toHaveCount(0);
  await expect(status(page)).toContainText(
    `本文 ${Array.from(firstText).length} 字符 / 全部文档 ${total} 字符`,
  );
  for (const name of ["contents.toml", "settings.toml"]) {
    await button(page, name).click();
    await expect(page.locator(".monaco-source .view-lines")).toContainText(
      name === "contents.toml" ? "[[documents]]" : "[reading]",
    );
    await expect(page.locator(".monaco-source .squiggly-error")).toHaveCount(0);
  }
  await tab(page, "文稿目录").click();
  await page
    .locator('.project-tree-row[data-path="markdown/second.md"]')
    .click();
  await tab(page, "源码").click();
  await page.getByRole("textbox", { name: "源码编辑器" }).focus();
  await page.keyboard.press("Control+End");
  await expect(status(page)).toContainText(`列 ${sourceColumn}`);
  await page.keyboard.insertText("增😀");
  const editedTotal = (Number(total.replaceAll(",", "")) + 2).toLocaleString(
    "zh-CN",
  );
  await expect(status(page)).toContainText(`全部文档 ${editedTotal} 字符`);
  await page.keyboard.press("Control+z");
  await expect(status(page)).toContainText(`全部文档 ${total} 字符`);
  await page.keyboard.press("Control+End");
});
expect(saved()).toMatchObject({
  path: second,
  view: "source",
  cursor: { column: sourceColumn },
});
const source = saved()!;
expect(source.scroll).toBeGreaterThan(0.5);

await session(async (page) => {
  await resume(page).click();
  await expect(title(page)).toContainText(second);
  await expect(tab(page, "源码")).toHaveAttribute("aria-selected", "true");
  await expect(status(page)).toContainText(
    `行 ${source.cursor!.line}，列 ${sourceColumn}`,
  );
  await tab(page, "可视化").click();
  const pageNumber = page.getByRole("spinbutton", {
    name: "页码",
    exact: true,
  });
  await expect(pageNumber).toBeEnabled();
  await pageNumber.fill((await pageNumber.getAttribute("max"))!);
  await button(page, "跳转").click();
  const text = page
    .locator(".document-body p")
    .filter({ hasText: /段落 120 / })
    .first();
  await text.click();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  await expect(status(page)).toContainText(/第 \d+ 页，正文字符 \d+/);
});
expect(saved()).toMatchObject({ path: second, view: "write" });
const visual = saved()!;
expect(visual.visual?.offset).toBeGreaterThan(0);

await session(async (page) => {
  await resume(page).click();
  await expect(tab(page, "可视化")).toHaveAttribute("aria-selected", "true");
  await expect
    .poll(() =>
      page.evaluate(() => window.getSelection()?.anchorNode?.textContent),
    )
    .toContain("段落 120");
  await tab(page, "预览").click();
  const viewport = page.locator(".paged-preview-viewport");
  await viewport.evaluate((node) => {
    node.scrollTop = (node.scrollHeight - node.clientHeight) * 0.55;
  });
  await expect
    .poll(() =>
      viewport.evaluate(
        (node) => node.scrollTop / (node.scrollHeight - node.clientHeight),
      ),
    )
    .toBeCloseTo(0.55, 1);
});
expect(saved()).toMatchObject({ path: second, view: "preview" });
expect(saved()!.scroll).toBeGreaterThan(0);

await session(async (page) => {
  await resume(page).click();
  await expect(title(page)).toContainText(second);
  const viewport = page.locator(".paged-preview-viewport");
  await expect
    .poll(() =>
      viewport.evaluate(
        (node) => node.scrollTop / (node.scrollHeight - node.clientHeight),
      ),
    )
    .toBeCloseTo(0.55, 1);
  await tab(page, "阅读").click();
  await expect(page.locator(".reader-manuscript h1")).toContainText("Second");
  const reader = page.locator(".reader-viewport");
  await reader.focus();
  await reader.press("PageDown");
});
expect(saved()).toMatchObject({ path: second, view: "reader" });
const reading = saved()!;
expect(reading.scroll).toBeGreaterThan(0);

await session(async (page) => {
  await resume(page).click();
  await expect(tab(page, "阅读")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".reader-manuscript h1")).toContainText("Second");
  await expect
    .poll(() =>
      page
        .locator(".reader-viewport")
        .evaluate(
          (node) => node.scrollLeft / (node.scrollWidth - node.clientWidth),
        ),
    )
    .toBeCloseTo(reading.scroll, 1);
  await button(page, "应用设置").click();
});
expect(saved()).toMatchObject({ path: second, view: "preview" });
expect(await fs.readFile(file)).toEqual(initialBytes);
console.log(
  "V2 control diagnostics, registered counts, default opening and four resumable views passed.",
);
