import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { AppState } from "../electron/state";
import { paginateMarkdown } from "../src/services/document-pages";

const executablePath = process.env.MARDIKOR_TEST_EXECUTABLE;
const root = path.resolve(".test-artifacts/continuous-pages");
await fs.mkdir(root, { recursive: true });
const run = await fs.mkdtemp(path.join(root, "run-"));
const profile = path.join(run, "profile");
const file = path.join(run, "continuous.md");
const pageLength = 2000;
const source = Array.from(
  { length: 6700 },
  (_, index) =>
    `## 第 ${index + 1} 节\n\n${"用来检查正文显示与连续滚动。".repeat(15)}\n\n- 项目一\n- 项目二\n- 项目三\n\n`,
).join("");
const layout = paginateMarkdown(source, pageLength);
const chapter = (index: number) =>
  /^## (.+)$/m.exec(source.slice(layout.pages[index].start))?.[1] ?? "";
await fs.writeFile(file, source);
new AppState(profile).preferences({
  autosave: false,
  autosaveInterval: 30,
  directorySyncThreshold: 200,
  externalOpenView: "preview",
  pageLength,
});
const env = {
  ...process.env,
  MARDIKOR_HEADLESS: "offscreen",
  MARDIKOR_USER_DATA: profile,
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.VITE_DEV_SERVER_URL;
const launch = (document: string) =>
  electron.launch({
    ...(executablePath
      ? { executablePath, args: ["--disable-gpu", document] }
      : { args: [".", document] }),
    env,
  });
const app = await launch(file);
const page = await app.firstWindow();
page.setDefaultTimeout(15000);
const errors: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));
const pane = page.locator(".editor-group").first();
const slice = (index: number) => pane.locator(`[data-page-index="${index}"]`);
const input = pane.getByRole("spinbutton", { name: "页码" });
const viewport = pane.locator(".paged-preview-viewport");
const go = async (number: number) => {
  await input.fill(String(number));
  await input.press("Enter");
  await expect(input).toHaveValue(String(number));
};
try {
  await expect(slice(0).locator("h2").first()).toHaveText(chapter(0));
  await expect(slice(1).locator("h2").first()).toHaveText(chapter(1));
  await expect(slice(1).locator(".document-page-marker")).toHaveText("2");

  // Scroll across the first boundary without pressing a pagination button.
  await slice(1).evaluate((node) => {
    const viewport = node.closest(".paged-preview-viewport")!;
    viewport.scrollTop +=
      node.getBoundingClientRect().top -
      viewport.getBoundingClientRect().top +
      30;
  });
  await expect(input).toHaveValue("2");
  await expect(slice(1).locator("h2").first()).toBeInViewport();

  await go(30);
  await expect(slice(29).locator("h2").first()).toHaveText(chapter(29));
  await expect(slice(29).locator("h2").first()).toBeInViewport();
  await expect
    .poll(() => pane.locator(".document-page").count())
    .toBeLessThan(12);
  await pane.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(input).toHaveValue("31");
  await expect(slice(30).locator("h2").first()).toBeInViewport();

  await pane.getByRole("tab", { name: "可视化", exact: true }).click();
  const editor = pane.locator('.document-body[contenteditable="true"]');
  await go(1);
  await expect(slice(0).locator(".document-body")).toBeVisible();
  await slice(0).locator(".document-body p").first().click();
  await page.keyboard.press("Home");
  await expect(editor).toBeFocused();
  const viewportBox = (await viewport.boundingBox())!;
  await page.mouse.move(
    viewportBox.x + viewportBox.width / 2,
    viewportBox.y + 130,
  );
  await page.mouse.wheel(0, 1450);
  await expect
    .poll(() => viewport.evaluate((node) => node.scrollTop))
    .toBeGreaterThan(300);
  await expect(editor).toBeFocused();
  await expect(slice(0).locator(".document-body")).toHaveCount(1);
  await editor.evaluate((node) => {
    const viewport = node.closest(".paged-preview-viewport")!;
    viewport.scrollTop +=
      node.getBoundingClientRect().bottom -
      viewport.getBoundingClientRect().top +
      30;
  });
  const target =
    1 +
    Number(
      await editor
        .locator("[data-editor-page]")
        .last()
        .getAttribute("data-editor-page"),
    );
  const newPage = slice(target);
  const paragraph = newPage.locator(".preview-body p").first();
  await expect(paragraph).toBeAttached();
  await newPage.evaluate((node) => {
    const viewport = node.closest(".paged-preview-viewport")!;
    viewport.scrollTop +=
      node.getBoundingClientRect().top -
      viewport.getBoundingClientRect().top -
      175;
  });
  await expect(paragraph).toBeInViewport();
  const geometry = () =>
    pane.evaluate((element, target) => {
      const preview = element.querySelector(
        `[data-page-index="${target}"] > .preview-body`,
      );
      const marker = element.querySelector(`[data-editor-page="${target}"]`);
      const rows: Element[] = [];
      let next = preview?.firstElementChild ?? marker?.nextElementSibling;
      while (
        next &&
        rows.length < 6 &&
        !next.hasAttribute("data-editor-page")
      ) {
        if (next.matches("h2,p,ul")) rows.push(next);
        next = next.nextElementSibling;
      }
      return rows.flatMap((node) =>
        [node, ...node.querySelectorAll("li")].map((row) => ({
          top: row.getBoundingClientRect().top,
          height: row.getBoundingClientRect().height,
        })),
      );
    }, target);
  const before = await geometry();
  expect(before.length).toBeGreaterThan(6);
  await editor.evaluate((node) =>
    node.setAttribute("data-test-editor-instance", "original"),
  );
  await paragraph.click({ position: { x: 3, y: 12 } });
  await expect(editor).toBeFocused();
  await expect(editor).toHaveAttribute("data-test-editor-instance", "original");
  await expect(pane.locator(`[data-editor-page="${target}"]`)).toHaveCount(1);
  await expect
    .poll(async () => {
      const after = await geometry();
      if (before.length !== after.length) return Infinity;
      return Math.max(
        ...before.map((row, index) =>
          Math.max(
            Math.abs(row.top - after[index].top),
            Math.abs(row.height - after[index].height),
          ),
        ),
      );
    })
    .toBeLessThanOrEqual(1);
  expect(
    await editor.locator("p:has(> br.ProseMirror-trailingBreak)").count(),
  ).toBe(0);
  await page.keyboard.press("Home");
  await page.keyboard.insertText("第二页编辑验证");
  await expect(editor).toContainText("第二页编辑验证");
  await page.keyboard.press("Control+s");
  await expect
    .poll(() => fs.readFile(file, "utf8"))
    .toContain("第二页编辑验证");
  await expect(editor).toBeFocused();
  await page.keyboard.press("Control+End");
  await expect(pane.locator(`[data-editor-page="${target + 2}"]`)).toHaveCount(
    1,
  );
  await expect(editor).toHaveAttribute("data-test-editor-instance", "original");
  await page.keyboard.press("Control+z");
  await expect(editor).not.toContainText("第二页编辑验证");
  await page.keyboard.press("Control+s");
  await expect.poll(() => fs.readFile(file, "utf8")).toBe(source);

  // Persist the setting through the application's normal Preferences route.
  await page.getByRole("button", { name: "应用设置", exact: true }).click();
  await page
    .getByRole("switch", { name: "显示分页标记", exact: true })
    .uncheck();
  await page.getByRole("button", { name: "保存偏好", exact: true }).click();
  await expect
    .poll(() => new AppState(profile).preferences().showPageMarkers)
    .toBe(false);
  await page.getByRole("button", { name: "编辑器", exact: true }).click();
  await pane.getByRole("tab", { name: "预览", exact: true }).click();
  await go(30);
  await expect(slice(29).locator("h2").first()).toBeInViewport();
  await expect(pane.locator(".document-page-marker")).toHaveCount(0);

  await page
    .getByRole("button", { name: "向右拆分编辑器", exact: true })
    .first()
    .click();
  const right = page.locator(".editor-group").nth(1);
  await right.getByRole("tab", { name: "预览", exact: true }).click();
  await go(12);
  const rightInput = right.getByRole("spinbutton", { name: "页码" });
  await expect(rightInput).toHaveValue("12");
  await expect(
    right.locator('[data-page-index="11"] h2').first(),
  ).toBeInViewport();
  await right.locator('[data-page-index="11"]').evaluate((node) => {
    const viewport = node.closest(".paged-preview-viewport")!;
    viewport.scrollTop += node.getBoundingClientRect().height + 40;
  });
  await expect(rightInput).toHaveValue("13");
  await expect(input).toHaveValue("13");

  expect(errors).toEqual([]);
  console.log(
    "Continuous scrolling, stable page geometry, focus-based loading, undo, page markers and bidirectional split sync passed.",
  );
} catch (error) {
  console.error(
    await viewport
      .evaluate((node) => ({
        scrollTop: node.scrollTop,
        pages: Array.from(
          node.querySelectorAll<HTMLElement>(
            "[data-page-index],[data-editor-page]",
          ),
        ).map((page) => ({
          index: page.dataset.pageIndex ?? page.dataset.editorPage,
          top: Math.round(page.getBoundingClientRect().top),
          height: Math.round(page.getBoundingClientRect().height),
          content: page.firstElementChild?.className,
        })),
      }))
      .catch(() => undefined),
  );
  await page
    .screenshot({ path: path.join(run, "failure.png") })
    .catch(() => {});
  throw error;
} finally {
  await page.evaluate(() => window.mardikor?.setDirty(false)).catch(() => {});
  await app.close();
}

const largeFile = path.join(run, "very-large.md");
const largeText =
  ("普通正文，用于检查超大文稿的连续预览。".repeat(12) + "\n\n").repeat(
    12_000,
  ) + "## 末页验证";
await fs.writeFile(largeFile, largeText);
const large = await launch(largeFile);
try {
  const window = await large.firstWindow();
  const input = window.getByRole("spinbutton", { name: "页码" });
  await expect(input).toBeEnabled({ timeout: 15000 });
  const count = Number(await input.getAttribute("max"));
  expect(count).toBeGreaterThan(1000);
  await expect(window.getByRole("tab", { name: "可视化" })).toBeDisabled();
  await input.fill(String(count));
  await input.press("Enter");
  await expect(input).toHaveValue(String(count));
  const last = window.locator(`[data-page-index="${count - 1}"]`);
  await expect(last.locator("p").first()).toBeInViewport();
  const end = last.locator("h2");
  await expect(end).toHaveText("末页验证");
  await window.locator(".paged-preview-viewport").evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  await expect(end).toBeInViewport();
  await expect
    .poll(() => window.locator(".document-page").count())
    .toBeLessThan(16);
  expect(
    await window
      .locator(".document-canvas")
      .evaluate((node) => node.scrollWidth - node.clientWidth),
  ).toBeLessThan(4);
  console.log(
    "Over two million characters stay bounded and can jump to the last page.",
  );
} finally {
  await large.close();
}
