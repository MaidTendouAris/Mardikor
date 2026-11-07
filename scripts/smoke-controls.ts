import { _electron as electron, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { AppState } from "../electron/state";
import * as mdk from "../electron/mdk";
import { selectOption } from "./select-option.mjs";

const executablePath = process.env.MARDIKOR_TEST_EXECUTABLE;
const root = path.resolve(
  executablePath
    ? ".test-artifacts/controls-packaged"
    : ".test-artifacts/controls-desktop",
);
await fs.mkdir(root, { recursive: true });
const run = await fs.mkdtemp(path.join(root, "run-")),
  profile = path.join(run, "profile"),
  file = path.join(run, "controls.mdk");
new AppState(profile).preferences({
  autosave: false,
  autosaveInterval: 30,
  directorySyncThreshold: 200,
});
const project = mdk.createMdkProject(file, "00");
project.settings.appearance.font_family = "Custom Existing Font";
mdk.updateMdkSettings(file, project.settings);
const env = {
  ...process.env,
  MARDIKOR_USER_DATA: profile,
  MARDIKOR_HEADLESS: "offscreen",
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
const errors: string[] = [];
try {
  page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().forEach((w) => {
      w.webContents.setBackgroundThrottling(false);
      w.setSize(1500, 1000);
    }),
  );
  await expect(page.locator(".document-title")).toContainText(
    "markdown/001.md",
  );
  await page.getByRole("button", { name: "应用设置", exact: true }).click();
  const preference = page.getByRole("combobox", {
    name: "双击文件时打开的视图",
    exact: true,
  });
  await expect(preference).toHaveAttribute("data-value", "preview");
  await preference.focus();
  await preference.press("ArrowDown");
  await expect(page.getByRole("listbox")).toBeVisible();
  await expect(
    page.getByRole("option", { name: "预览", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(
    page.getByRole("option", { name: "源码", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(preference).toHaveAttribute("data-value", "source");
  await preference.click();
  await page.keyboard.press("End");
  await page.keyboard.press("Escape");
  await expect(preference).toHaveAttribute("data-value", "source");
  await expect(preference).toBeFocused();
  await page.getByRole("button", { name: "保存偏好", exact: true }).click();
  await expect
    .poll(() =>
      page!.evaluate(
        async () => (await window.mardikor!.preferences()).externalOpenView,
      ),
    )
    .toBe("source");
  await preference.click();
  await expect(page.getByRole("listbox")).toHaveCSS("opacity", "1");
  if (!executablePath)
    await page.screenshot({ path: path.join(root, "custom-dropdown.png") });
  await page.keyboard.press("Escape");
  const about = page.getByRole("region", { name: "关于 Mardikor" });
  await expect(about.locator(".setting-row > code")).toHaveText(
    await app.evaluate(({ app }) => app.getVersion()),
  );
  await about.getByText("许可证（GPL-3.0-only）", { exact: true }).click();
  const license = about.getByLabel("GPLv3 许可证全文");
  await expect(license).toBeVisible();
  expect((await license.textContent())?.replace(/\r\n/g, "\n")).toBe(
    (await fs.readFile("LICENSE", "utf8")).replace(/\r\n/g, "\n"),
  );
  await about.getByText("命令行使用指南", { exact: true }).click();
  const cliGuide = about.getByRole("region", { name: "命令行指南全文" });
  await expect(cliGuide).toBeVisible();
  await expect(cliGuide).toContainText("mardikor list");
  const opened: string[] = [];
  await app.evaluate(({ shell }) => {
    shell.openExternal = async (url) => {
      (
        globalThis as typeof globalThis & { openedAboutUrls?: string[] }
      ).openedAboutUrls ??= [];
      (
        globalThis as typeof globalThis & { openedAboutUrls: string[] }
      ).openedAboutUrls.push(url);
    };
  });
  for (const [name, suffix] of [
    ["GitHub 仓库", ""],
    ["问题反馈", "/issues"],
  ]) {
    const url = "https://github.com/MaidTendouAris/Mardikor" + suffix;
    const link = about.getByRole("link", { name, exact: true });
    await expect(link).toHaveAttribute("href", url);
    await link.click();
    opened.push(url);
  }
  await expect
    .poll(() =>
      app.evaluate(
        () =>
          (globalThis as typeof globalThis & { openedAboutUrls: string[] })
            .openedAboutUrls,
      ),
    )
    .toEqual(opened);
  await page.getByRole("button", { name: "编辑器", exact: true }).click();
  await page.getByRole("tab", { name: "工程设置", exact: true }).click();
  const font = page.getByRole("combobox", { name: "字体", exact: true });
  await expect(font).toHaveValue("Custom Existing Font");
  await font.focus();
  await font.press("ArrowDown");
  await expect(
    page.getByRole("listbox", { name: "字体建议", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(font).toHaveValue("Arial");
  await font.fill("Noto Sans CJK");
  await expect(
    page.getByRole("listbox", { name: "字体建议", exact: true }),
  ).toContainText("可直接输入");
  await font.press("Escape");
  await expect(font).toHaveValue("Noto Sans CJK");
  await page.getByRole("button", { name: "选择字体", exact: true }).click();
  await expect(page.getByRole("listbox", { name: "字体建议" })).toHaveCSS(
    "opacity",
    "1",
  );
  if (!executablePath)
    await page.screenshot({ path: path.join(root, "font-suggestions.png") });
  await page
    .getByRole("option", { name: "Times New Roman", exact: true })
    .click();
  await expect(font).toHaveValue("Times New Roman");
  await expect(font).toBeFocused();
  await selectOption(
    page,
    page.getByRole("combobox", { name: "阅读方向", exact: true }),
    "rtl",
  );
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect
    .poll(() => mdk.openMdkProject(file).settings.appearance.font_family)
    .toBe("Times New Roman");
  expect(mdk.openMdkProject(file).settings.mode.comic.reading_direction).toBe(
    "rtl",
  );
  const toggle = page.getByRole("button", {
    name: "收起或展开导航",
    exact: true,
  });
  const animate = async () => {
    await page!.locator(".navigation").evaluate((node) => {
      const state = window as Window & { navWidths?: number[] };
      state.navWidths = [node.getBoundingClientRect().width];
      const timer = setInterval(() => {
        state.navWidths!.push(node.getBoundingClientRect().width);
      }, 8);
      setTimeout(() => clearInterval(timer), 700);
    });
    await toggle.click();
    await new Promise((resolve) => setTimeout(resolve, 750));
    return page!.evaluate(
      () => (window as Window & { navWidths: number[] }).navWidths,
    );
  };
  const closing = await animate();
  expect(closing[0]).toBeGreaterThan(180);
  expect(closing.at(-1)).toBeCloseTo(70, 0);
  expect(closing.some((width) => width > 80 && width < 175)).toBe(true);
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".nav-projects")).toHaveAttribute("inert", "");
  const opening = await animate();
  expect(opening.at(-1)).toBeGreaterThan(180);
  expect(opening.some((width) => width > 80 && width < 175)).toBe(true);
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await page.evaluate(async () => {
    const toggle =
      document.querySelector<HTMLButtonElement>(".workspace-label")!;
    toggle.click();
    await new Promise((resolve) => setTimeout(resolve, 70));
    toggle.click();
  });
  await expect
    .poll(() =>
      page!
        .locator(".navigation")
        .evaluate((node) => node.getBoundingClientRect().width),
    )
    .toBeGreaterThan(180);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await toggle.click();
  await expect
    .poll(() =>
      page!
        .locator(".navigation")
        .evaluate((node) => node.getBoundingClientRect().width),
    )
    .toBeCloseTo(70, 0);
  expect(
    await page
      .locator(".navigation")
      .evaluate((node) => node.getAnimations().length),
  ).toBe(0);
  await toggle.click();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(
    page.getByRole("button", { name: "编辑器", exact: true }),
  ).toBeVisible();
  if (!executablePath)
    await page.screenshot({ path: path.join(root, "font-and-navigation.png") });
  expect(errors).toEqual([]);
  console.log(
    "Custom dropdown keyboard/escape, persisted values, editable font suggestions and animated/reduced-motion navigation passed.",
  );
} catch (error) {
  if (page && !executablePath)
    await page
      .screenshot({ path: path.join(root, "failure.png") })
      .catch(() => {});
  console.error(
    await page
      ?.locator(".toast")
      .allTextContents()
      .catch(() => []),
  );
  throw error;
} finally {
  await page?.evaluate(() => window.mardikor!.setDirty(false)).catch(() => {});
  await app.close();
}
