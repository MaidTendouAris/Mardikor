import { _electron as electron, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { AppState } from "../electron/state";
import { selectOption } from "./select-option.mjs";
import { createMdkProject, readMdkTextFile, saveMdkTextFile } from "../electron/mdk";

const executablePath = process.env.MARDIKOR_TEST_EXECUTABLE;
const root = path.resolve(
  executablePath
    ? ".test-artifacts/open-preview-packaged"
    : ".test-artifacts/open-preview-desktop",
);
await fs.mkdir(root, { recursive: true });
const run = await fs.mkdtemp(path.join(root, "run-")),
  profile = path.join(run, "profile"),
  markdown = path.join(run, "直接打开.MD"),
  largeMarkdown = path.join(run, "分页布局.md"),
  archive = path.join(run, "直接打开.mdk");
await fs.writeFile(
  markdown,
  "# Markdown 预览\n\n## 文档标题\n\n直接打开文件进入预览。\n",
  "utf8",
);
const heading = "# 大文档性能测试\n";
const section =
  "\n## 测试章节\n\n这是用于验证长文稿分页、滚动和界面布局的正文。 Markdown document sample 123456789.\n\n- 项目一\n- 项目二\n";
const tail = "\n\n## 末页标记\n";
const size = 2_814_973 - heading.length - tail.length;
await fs.writeFile(
  largeMarkdown,
  heading +
    section.repeat(Math.ceil(size / section.length)).slice(0, size) +
    tail,
);
createMdkProject(archive, "01");
saveMdkTextFile(
  archive,
  "markdown/001.md",
  "# MDK 预览\n\n直接打开工程进入预览。\n",
);
const hashes = await Promise.all(
  [markdown, archive].map(async (file) =>
    createHash("sha256")
      .update(await fs.readFile(file))
      .digest("hex"),
  ),
);
new AppState(profile).preferences({
  autosave: false,
  autosaveInterval: 30,
  directorySyncThreshold: 200,
});
const env = {
  ...process.env,
  MARDIKOR_USER_DATA: profile,
  MARDIKOR_HEADLESS: "1",
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.VITE_DEV_SERVER_URL;
const launch = (file: string) =>
  electron.launch({
    ...(executablePath
      ? { executablePath, args: ["--disable-gpu", file] }
      : { args: [".", file] }),
    env,
    timeout: 30000,
  });
let app = await launch(markdown),
  page: Page | undefined;
const errors: string[] = [];
async function prepare() {
  page = app.windows().at(-1) ?? (await app.firstWindow());
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().forEach((window) => {
      window.webContents.setBackgroundThrottling(false);
      window.setSize(1440, 940);
    }),
  );
}
async function preview(title: string, heading: string) {
  await expect(page!.locator(".document-title")).toContainText(title);
  await expect(
    page!.getByRole("tab", { name: "预览", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page!.locator(".reading-preview h1")).toContainText(heading);
  await expect(page!.locator(".source-workspace")).toBeHidden();
}
async function chooseView(value: "preview" | "source" | "write") {
  await page!.getByRole("button", { name: "应用设置", exact: true }).click();
  await selectOption(
    page!,
    page!.getByLabel("双击文件时打开的视图", { exact: true }),
    value,
  );
  await page!.getByRole("button", { name: "保存偏好", exact: true }).click();
  await expect
    .poll(() =>
      page!.evaluate(
        async () => (await window.mardikor!.preferences()).externalOpenView,
      ),
    )
    .toBe(value);
}
async function secondInstance(file: string) {
  const next = app.waitForEvent("window");
  await app.evaluate(({ app }, file) => {
    app.emit("second-instance", {}, [app.getPath("exe"), file], process.cwd());
  }, file);
  await next;
  await prepare();
}
async function closeAll() {
  for (const window of app.windows())
    await window
      .evaluate(() => window.mardikor?.setDirty(false))
      .catch(() => {});
  await app.close();
}

try {
  await prepare();
  await preview(path.basename(markdown), "Markdown 预览");
  await page!.getByRole("tab", { name: "源码", exact: true }).click();
  await page!.getByRole("tab", { name: "预览", exact: true }).click();
  await preview(path.basename(markdown), "Markdown 预览");
  if (!executablePath)
    await page!.screenshot({
      path: path.join(root, "blue-titlebar-preview.png"),
    });
  await page!.getByRole("tab", { name: "源码", exact: true }).click();
  await chooseView("source");
  await secondInstance(archive);
  await expect(page!.locator(".document-title")).toContainText(
    "markdown/001.md",
  );
  await expect(
    page!.getByRole("tab", { name: "源码", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await chooseView("write");
  await secondInstance(markdown);
  await expect(
    page!.getByRole("tab", { name: "可视化", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page!.locator(".document-body h1")).toHaveText("Markdown 预览");
  await page!.evaluate(() => window.mardikor!.setDirty(false));
  await closeAll();
  app = await launch(archive);
  await prepare();
  await expect(
    page!.getByRole("tab", { name: "可视化", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page!.locator(".document-body h1")).toHaveText("MDK 预览");
  await chooseView("preview");
  await secondInstance(markdown);
  await preview(path.basename(markdown), "Markdown 预览");
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
  }, archive);
  await page!.getByRole("button", { name: "打开工程", exact: true }).click();
  await preview("markdown/001.md", "MDK 预览");
  await secondInstance(markdown);
  await preview(path.basename(markdown), "Markdown 预览");
  await page!.evaluate(() => window.mardikor!.setDirty(false));
  await closeAll();
  app = await launch(archive);
  await prepare();
  await preview("markdown/001.md", "MDK 预览");
  await expect(page!.locator(".preview-toc, .outline-help")).toHaveCount(0);
  await expect(page!.locator(".heading-outline")).toContainText("MDK 预览");
  await chooseView("write");
  await secondInstance(largeMarkdown);
  const left = page!.getByRole("region", { name: "左栏编辑组" });
  const header = left.locator(".document-tabs");
  const pager = header.getByRole("navigation", { name: "翻页" });
  const pageNumber = pager.getByRole("spinbutton", { name: "页码" });
  await expect(left.getByRole("tab", { name: "可视化" })).toBeDisabled();
  await expect(left.getByRole("tab", { name: "预览" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(left.locator(".paged-preview-viewport h1")).toHaveText(
    "大文档性能测试",
  );
  await expect(
    left.locator(".rich-toolbar-container,.source-warning"),
  ).toHaveCount(0);
  const headerBox = (await header.boundingBox())!;
  const pagerBox = (await pager.boundingBox())!;
  const previewBox = (await left
    .locator(".paged-preview-viewport")
    .boundingBox())!;
  expect(pagerBox.x).toBeGreaterThan(headerBox.x + headerBox.width / 2);
  expect(
    Math.abs(previewBox.y - (headerBox.y + headerBox.height)),
  ).toBeLessThanOrEqual(1);
  const count = Number(await pageNumber.getAttribute("max"));
  expect(count).toBeGreaterThan(300);
  await pageNumber.fill(String(count));
  await pageNumber.press("Enter");
  await expect(left.locator(".paged-preview-viewport")).toContainText(
    "末页标记",
  );
  await left.getByRole("tab", { name: "源码" }).click();
  await expect(pager).toBeVisible();
  await expect(pageNumber).toBeDisabled();
  await expect(left.locator(".source-warning")).toHaveCount(0);
  await left.getByRole("button", { name: "切换源码与预览分栏" }).click();
  await expect(pageNumber).toBeEnabled();
  await page!.getByRole("button", { name: "向右拆分编辑器" }).click();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().forEach((window) =>
      window.setSize(1024, 900),
    ),
  );
  await page!
    .getByRole("separator", { name: "调整左右编辑组宽度" })
    .press("Home");
  await expect(pager).toBeVisible();
  const narrow = (await header.boundingBox())!;
  const narrowPager = (await pager.boundingBox())!;
  expect(narrowPager.x + narrowPager.width).toBeLessThanOrEqual(
    narrow.x + narrow.width,
  );
  expect(
    await header.evaluate((node) => node.scrollWidth - node.clientWidth),
  ).toBeLessThanOrEqual(1);
  expect(
    await Promise.all(
      [markdown, archive].map(async (file) =>
        createHash("sha256")
          .update(await fs.readFile(file))
          .digest("hex"),
      ),
    ),
  ).toEqual(hashes);
  await app.evaluate(({ BrowserWindow }, title) => {
    BrowserWindow.getAllWindows().find((window) => window.title === title)?.close();
  }, `${path.basename(archive)} - Mardikor`);
  await expect.poll(() => app.windows().length).toBe(1);
  await page!.locator(".nav-projects").getByTitle(archive, { exact: true }).click();
  await preview("markdown/001.md", "MDK 预览");
  const visual = page!.getByRole("tab", { name: "可视化", exact: true });
  await visual.click();
  const renamed = path.join(run, "改名后的工程.mdk");
  const save = page!.locator(".document-topbar").getByRole("button", {
    name: "保存",
    exact: true,
  });
  await page!.getByRole("button", { name: "重命名 MDK 工程" }).click();
  await page!.getByRole("textbox", { name: "重命名 MDK 工程" }).fill("改名后的工程");
  await page!.getByRole("dialog").getByRole("button", { name: "重命名" }).click();
  await expect(page!.locator(".titlebar-caption")).toHaveText(path.basename(renamed));
  await expect(page!.locator(".nav-projects button").first()).toHaveAttribute(
    "title",
    renamed,
  );
  await expect(visual).toHaveAttribute("aria-selected", "true");
  await expect(fs.access(archive)).rejects.toThrow();
  expect(createHash("sha256").update(await fs.readFile(renamed)).digest("hex"))
    .toBe(hashes[1]);
  const body = page!.locator(".document-body[contenteditable=true]");
  await body.click();
  await page!.keyboard.press("Control+End");
  await page!.keyboard.insertText(" 改名后继续编辑");
  await page!.keyboard.press("Control+s");
  await expect(save).toContainText("已保存");
  await expect(page!.locator(".toast").filter({ hasText: "工程已保存" })).toHaveCount(0);
  await expect(body).toBeFocused();
  expect(readMdkTextFile(renamed, "markdown/001.md").content)
    .toContain("改名后继续编辑");
  expect(errors).toEqual([]);
  console.log(
    "External open preferences, large-document fallback, and fixed pagination in preview/source and narrow splits passed.",
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
  await closeAll();
}
