import { _electron as electron, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { AppState } from "../electron/state";
import * as mdk from "../electron/mdk";
import { maxReadingPresets } from "../shared/reading";
import { selectOption } from "./select-option.mjs";

const root = path.resolve(".test-artifacts/reader");
await fs.mkdir(root, { recursive: true });
const run = await fs.mkdtemp(path.join(root, "run-"));
const profile = path.join(run, "profile");
const book = path.join(run, "reader-book.mdk");
const comic = path.join(run, "reader-comic.mdk");
const general = path.join(run, "reader-general.mdk");
const state = new AppState(profile);
state.preferences({
  ...state.preferences(),
  autosave: false,
  language: "zh-CN",
});

function add(file: string, name: string, position: string, markdown: string) {
  mdk.applyMdkBatch(file, mdk.fileRevision(file), {
    writes: [],
    positions: [],
    newEntries: [{ path: `markdown/${name}.md`, position, markdown }],
  });
}
mdk.createMdkProject(book, "01");
const bookSettings = mdk.openMdkProject(book).settings;
bookSettings.appearance.font_size = 38;
bookSettings.colors.background = "#ff00ff";
mdk.updateMdkSettings(book, bookSettings);
const sections = Array.from(
  { length: 42 },
  (_, i) =>
    `## 小节 ${i + 1}\n\n${"适合用于验证分屏阅读和版面设置的段落。".repeat(12)}`,
);
mdk.saveMdkTextFile(
  book,
  "markdown/001.md",
  "# 阅读测试\n\n" + sections.join("\n\n"),
);
add(book, "next", "2", "# 下一章\n\n[回到小节 40](001.md#小节-40)");
mdk.createMdkProject(comic, "02");
const image = mdk.importMdkResource(
  comic,
  path.resolve("assets/icon.png"),
  "image",
);
mdk.saveMdkTextFile(
  comic,
  "markdown/001.md",
  `# 漫画第一页\n\n![测试图片](../${image.path})`,
);
add(comic, "second", "2", "# 漫画第二页\n\n图文混排。");
add(comic, "third", "3", "# 漫画第三页");
mdk.createMdkProject(general, "00");
const revisions = [book, comic, general].map(mdk.fileRevision);

const executablePath = process.env.MARDIKOR_TEST_EXECUTABLE;
const env = {
  ...process.env,
  MARDIKOR_HEADLESS: "offscreen",
  MARDIKOR_USER_DATA: profile,
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.VITE_DEV_SERVER_URL;
const launch = (...files: string[]) =>
  electron.launch({
    ...(executablePath
      ? { executablePath, args: ["--disable-gpu", ...files] }
      : { args: [".", ...files] }),
    env,
    timeout: 30000,
  });

let app = await launch(book, comic, general);
const errors: string[] = [];
async function windowFor(file: string) {
  const captions = (page: Page) =>
    page.locator(".titlebar-caption").allTextContents();
  await expect
    .poll(async () =>
      (await Promise.all(app.windows().map(captions)))
        .flat()
        .includes(path.basename(file)),
    )
    .toBe(true);
  for (const page of app.windows()) {
    if (!(await captions(page)).includes(path.basename(file))) continue;
    page.setDefaultTimeout(15000);
    page.on("pageerror", (error) => errors.push(error.message));
    return page;
  }
  throw Error("Missing reader window.");
}
const reader = (page: Page) =>
  page.getByRole("region", { name: "阅读模式", exact: true });
async function read(page: Page) {
  await page.getByRole("tab", { name: "阅读", exact: true }).click();
  await expect(reader(page)).toBeVisible();
}
const panel = (page: Page) =>
  page.getByRole("dialog", { name: "阅读设置", exact: true });
async function showSettings(page: Page) {
  if (!(await panel(page).isVisible()))
    await reader(page)
      .getByRole("button", { name: "阅读设置", exact: true })
      .click();
  await expect(panel(page)).toBeVisible();
}
async function closeSettings(page: Page) {
  if (await panel(page).isVisible())
    await panel(page)
      .getByRole("button", { name: "关闭阅读设置", exact: true })
      .click();
}
async function apply(page: Page) {
  await panel(page)
    .getByRole("button", { name: "应用阅读设置", exact: true })
    .click();
}

try {
  const bookPage = await windowFor(book);
  const comicPage = await windowFor(comic);
  const generalPage = await windowFor(general);
  await expect(
    generalPage.getByRole("tab", { name: "预览", exact: true }),
  ).toBeVisible();
  await expect(
    generalPage.getByRole("tab", { name: "阅读", exact: true }),
  ).toHaveCount(0);
  await read(bookPage);
  const bookReader = reader(bookPage);
  const viewport = bookReader.locator(".reader-viewport");
  const bookFlow = viewport.locator(".reader-spread");
  const spreadInput = bookReader.getByRole("spinbutton", { name: "跨页序号" });
  const resizeBook = (width: number, height: number) =>
    app.evaluate(
      ({ BrowserWindow }, { name, width, height }) => {
        BrowserWindow.getAllWindows()
          .find((window) => window.getTitle().startsWith(name + " -"))
          ?.setSize(width, height);
      },
      { name: path.basename(book), width, height },
    );
  await resizeBook(1120, 850);
  await expect(
    bookReader.getByRole("heading", { name: "阅读测试" }),
  ).toBeVisible();
  await expect(bookReader.locator(".reader-manuscript")).toHaveCSS(
    "font-size",
    "18px",
  );
  await expect(bookReader).toHaveCSS("background-color", "rgb(255, 255, 255)");
  const pageInput = bookReader.getByRole("spinbutton", { name: "页码" });
  await expect
    .poll(async () => Number(await pageInput.getAttribute("max")))
    .toBeGreaterThan(2);
  await bookReader.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(pageInput).toHaveValue("2");
  await expect
    .poll(() => viewport.evaluate((node) => node.scrollLeft))
    .toBeGreaterThan(0);
  const last = (await pageInput.getAttribute("max"))!;
  await pageInput.fill(last);
  await pageInput.press("Enter");
  await expect(pageInput).toHaveValue(last);
  await bookReader.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(
    bookReader.getByRole("heading", { name: "下一章" }),
  ).toBeVisible();
  const initialRow = bookPage.locator(
    '.project-tree-row[data-path="markdown/001.md"]',
  );
  await initialRow.click();
  await expect(
    bookReader.getByRole("heading", { name: "阅读测试" }),
  ).toBeInViewport();
  await bookReader
    .getByRole("button", { name: "下一文稿", exact: true })
    .click();
  await bookReader.getByRole("link", { name: "回到小节 40" }).click();
  await expect(
    bookReader.getByRole("heading", { name: "小节 40", exact: true }),
  ).toBeInViewport();

  await showSettings(bookPage);
  await panel(bookPage).getByRole("checkbox", { name: "隐藏侧边栏" }).check();
  await apply(bookPage);
  await closeSettings(bookPage);
  await resizeBook(1680, 860);
  await expect(bookFlow).toHaveCSS("column-count", "2");
  await expect
    .poll(() => viewport.evaluate((node) => node.clientWidth))
    .toBeGreaterThan(1450);
  await spreadInput.fill("1");
  await spreadInput.press("Enter");
  await expect(spreadInput).toHaveValue("1");
  expect(
    await viewport.evaluate((node) => {
      const { left, width, right } = node.getBoundingClientRect();
      return Array.from(node.querySelectorAll("h2")).some((heading) => {
        const x = heading.getBoundingClientRect().left;
        return x > left + width / 2 && x < right;
      });
    }),
  ).toBe(true);
  await bookReader.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(spreadInput).toHaveValue("2");
  await expect
    .poll(() => viewport.evaluate((node) => node.scrollLeft / node.clientWidth))
    .toBeGreaterThan(1);

  await showSettings(bookPage);
  await selectOption(
    bookPage,
    panel(bookPage).getByLabel("书籍翻页布局"),
    "double",
  );
  await selectOption(
    bookPage,
    panel(bookPage).getByLabel("阅读区宽度"),
    "limited",
  );
  await panel(bookPage)
    .getByLabel("单页宽度（px）", { exact: true })
    .fill("480");
  await panel(bookPage).getByLabel("页间距（px）", { exact: true }).fill("56");
  await panel(bookPage)
    .getByLabel("左右留白（px）", { exact: true })
    .fill("80");
  await panel(bookPage)
    .getByLabel("上下留白（px）", { exact: true })
    .fill("40");
  await apply(bookPage);
  await expect(bookFlow).toHaveCSS("column-count", "2");
  await expect(bookFlow).toHaveCSS("column-gap", "56px");
  await expect(viewport).toHaveCSS("width", "1016px");
  await expect(bookReader).toHaveCSS("padding-left", "80px");
  await expect(bookReader).toHaveCSS("padding-top", "40px");
  await closeSettings(bookPage);

  // Resize until the final spread has just one logical page. It should
  // align at the same left edge as a full spread instead of overlapping.
  async function pagesInBook() {
    return bookFlow.evaluate((node) => {
      const gap = Number.parseFloat(getComputedStyle(node).columnGap);
      const width = node.getBoundingClientRect().width;
      return 2 + Math.round((node.scrollWidth - width) / ((width + gap) / 2));
    });
  }
  let logicalPages = await pagesInBook();
  for (const height of [780, 920, 1000, 820, 960]) {
    if (logicalPages % 2 === 1) break;
    await resizeBook(1680, height);
    await expect
      .poll(async () =>
        Math.abs((await bookPage.evaluate(() => window.innerHeight)) - height),
      )
      .toBeLessThanOrEqual(2);
    logicalPages = await pagesInBook();
  }
  expect(logicalPages % 2).toBe(1);
  await expect(spreadInput).toHaveAttribute(
    "max",
    String(Math.ceil(logicalPages / 2)),
  );
  await spreadInput.fill(String(Math.ceil(logicalPages / 2)));
  await spreadInput.press("Enter");
  const finalSpreadOffset = (Math.ceil(logicalPages / 2) - 1) * 1072;
  await expect
    .poll(() =>
      viewport.evaluate(
        (node, offset) => Math.abs(node.scrollLeft - offset),
        finalSpreadOffset,
      ),
    )
    .toBeLessThanOrEqual(1);

  await showSettings(bookPage);
  await panel(bookPage).getByRole("checkbox", { name: "隐藏侧边栏" }).uncheck();
  await apply(bookPage);
  await closeSettings(bookPage);
  await resizeBook(1120, 850);
  await expect(bookFlow).toHaveCSS("column-count", "1");
  await expect(viewport).toHaveCSS("width", "480px");

  await showSettings(bookPage);
  await selectOption(
    bookPage,
    panel(bookPage).getByLabel("阅读方式", { exact: true }),
    "scroll",
  );
  await selectOption(bookPage, panel(bookPage).getByLabel("阅读区宽度"), "fit");
  await panel(bookPage)
    .getByLabel("阅读字号（px）", { exact: true })
    .fill("24");
  await panel(bookPage).getByLabel("阅读行距", { exact: true }).fill("2");
  await panel(bookPage)
    .getByLabel("正文首行缩进（em）", { exact: true })
    .fill("2");
  await panel(bookPage).getByRole("checkbox", { name: "隐藏侧边栏" }).check();
  await apply(bookPage);
  await resizeBook(1680, 860);
  await expect
    .poll(() => viewport.evaluate((node) => node.clientWidth))
    .toBeGreaterThan(1400);
  await expect(
    bookReader.getByRole("spinbutton", { name: "页码" }),
  ).toHaveCount(0);
  await expect(bookPage.locator(".navigation")).toBeHidden();
  await expect(bookPage.locator(".outline-panel")).toBeHidden();
  await expect(bookReader.locator(".reader-manuscript")).toHaveCSS(
    "font-size",
    "24px",
  );
  await expect(bookReader.locator(".reader-markdown p").first()).toHaveCSS(
    "text-indent",
    "48px",
  );
  await expect(bookReader.locator(".reader-markdown p").first()).toHaveCSS(
    "line-height",
    "48px",
  );
  await viewport.evaluate((node) => {
    node.scrollTop = 700;
  });
  await expect
    .poll(() => viewport.evaluate((node) => node.scrollTop))
    .toBeGreaterThan(400);
  await panel(bookPage)
    .getByRole("button", { name: "保存为阅读预设", exact: true })
    .click();
  const saveName = bookPage
    .getByRole("dialog")
    .getByRole("textbox", { name: "保存为阅读预设" });
  await saveName.fill("大字号");
  await saveName.press("Enter");
  await expect
    .poll(() => new AppState(profile).readingPreferences().presets[0]?.name)
    .toBe("大字号");
  await showSettings(bookPage);
  await panel(bookPage)
    .getByRole("button", { name: "重命名", exact: true })
    .click();
  const rename = bookPage
    .getByRole("dialog")
    .getByRole("textbox", { name: "重命名阅读预设" });
  await rename.fill("长文阅读");
  await rename.press("Enter");
  await expect
    .poll(() => new AppState(profile).readingPreferences().presets[0]?.name)
    .toBe("长文阅读");
  await closeSettings(bookPage);
  await bookPage.getByRole("tab", { name: "预览", exact: true }).click();
  await expect(bookPage.locator(".navigation")).toBeVisible();
  await expect(bookPage.locator(".outline-panel")).toBeVisible();

  await read(comicPage);
  const comicReader = reader(comicPage);
  await expect(
    comicReader.getByRole("heading", { name: "漫画第一页" }),
  ).toBeVisible();
  await expect
    .poll(() =>
      comicReader
        .getByRole("img", { name: "测试图片" })
        .evaluate((node: HTMLImageElement) => node.naturalWidth),
    )
    .toBeGreaterThan(0);
  await showSettings(comicPage);
  await selectOption(
    comicPage,
    panel(comicPage).getByLabel("阅读方式", { exact: true }),
    "paged",
  );
  await selectOption(
    comicPage,
    panel(comicPage).getByLabel("漫画翻页布局", { exact: true }),
    "double",
  );
  await selectOption(
    comicPage,
    panel(comicPage).getByLabel("漫画翻页方向", { exact: true }),
    "rtl",
  );
  await apply(comicPage);
  await closeSettings(comicPage);
  const firstPage = comicReader.getByRole("heading", { name: "漫画第一页" });
  const secondPage = comicReader.getByRole("heading", { name: "漫画第二页" });
  await expect(secondPage).toBeVisible();
  expect((await firstPage.boundingBox())!.x).toBeGreaterThan(
    (await secondPage.boundingBox())!.x,
  );
  await comicReader
    .getByRole("button", { name: "下一页", exact: true })
    .click();
  await expect(
    comicReader.getByRole("heading", { name: "漫画第三页" }),
  ).toBeVisible();
  await expect(comicReader.locator(".reader-manuscript")).toHaveCount(1);
  const saved = new AppState(profile).readingPreferences();
  expect(saved.style.comicSpread).toBe("double");
  expect(saved.presets[0].style.layout).toBe("scroll");
  expect(saved.presets[0].style.fontSize).toBe(24);
  await comicPage.evaluate(async (limit) => {
    const api = window.mardikor!;
    const current = await api.readingPreferences();
    for (let i = current.presets.length; i < limit; i++)
      await api.readingPreferences({
        kind: "create",
        name: `Preset ${i}`,
        style: current.style,
      });
  }, maxReadingPresets);
  await expect(
    comicPage.evaluate(async () => {
      const api = window.mardikor!;
      const { style } = await api.readingPreferences();
      await api.readingPreferences({ kind: "create", name: "Too many", style });
    }),
  ).rejects.toThrow(/16/);
  await app.close();
  const local = new AppState(profile);
  local.preferences({ ...local.preferences(), appTheme: "dark" });
  app = await launch(book);
  const restarted = await windowFor(book);
  await read(restarted);
  await expect(reader(restarted)).toHaveCSS(
    "background-color",
    "rgb(20, 20, 20)",
  );
  await showSettings(restarted);
  await expect(
    panel(restarted).getByRole("button", {
      name: "保存为阅读预设",
      exact: true,
    }),
  ).toBeDisabled();
  const preset = new AppState(profile).readingPreferences().presets[0];
  await selectOption(
    restarted,
    panel(restarted).getByLabel("阅读预设", { exact: true }),
    preset.id,
  );
  await panel(restarted)
    .getByRole("button", { name: "应用预设", exact: true })
    .click();
  await expect(reader(restarted).locator(".reader-manuscript")).toHaveCSS(
    "font-size",
    "24px",
  );
  await expect(restarted.locator(".outline-panel")).toBeHidden();
  expect([book, comic, general].map(mdk.fileRevision)).toEqual(revisions);
  expect(errors).toEqual([]);
  console.log(
    "Book landscape spreads, odd final pages, responsive margins and widths, comic RTL spreads, local presets and unchanged MDK bytes passed.",
  );
} finally {
  await app.close();
}
