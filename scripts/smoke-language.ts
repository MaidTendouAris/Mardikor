import {
  _electron as electron,
  expect,
  type ElectronApplication,
} from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { AppState } from "../electron/state";
import { createMdkProject, saveMdkTextFile } from "../electron/mdk";
import type { AppLocale, LanguagePreference } from "../shared/i18n";
import { selectOption } from "./select-option.mjs";

const executablePath = process.env.MARDIKOR_TEST_EXECUTABLE;
const root = path.resolve(".test-artifacts/language");
await fs.mkdir(root, { recursive: true });
const run = await fs.mkdtemp(path.join(root, "run-"));
const profile = path.join(run, "profile");
const file = path.join(run, "locale.mdk");
createMdkProject(file, "01");
saveMdkTextFile(
  file,
  "markdown/001.md",
  "# Sample Heading\n\n[Broken link](#missing-anchor)\n",
);

async function launch(systemLocale: string) {
  const env = {
    ...process.env,
    MARDIKOR_USER_DATA: profile,
    MARDIKOR_HEADLESS: "offscreen",
    MARDIKOR_TEST_SYSTEM_LOCALE: systemLocale,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.VITE_DEV_SERVER_URL;
  return electron.launch({
    ...(executablePath
      ? { executablePath, args: ["--disable-gpu", file] }
      : { args: [".", file] }),
    env,
  });
}

async function check(
  app: ElectronApplication,
  locale: AppLocale,
  saved: LanguagePreference,
  next?: LanguagePreference,
) {
  const page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  const en = locale === "en";
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
  await expect(page.locator(".document-title")).toContainText(
    "markdown/001.md",
  );
  await expect(
    page.getByRole("tab", { name: en ? "Preview" : "预览", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".preview-body")).toContainText("Broken link");
  await page
    .getByRole("tab", { name: en ? "Source" : "源码", exact: true })
    .click();
  const source = page.getByRole("textbox", {
    name: en ? "Source Editor" : "源码编辑器",
    exact: true,
  });
  await expect(source).toBeVisible();
  await source.focus();
  await page.keyboard.press("Shift+F10");
  await expect(page.locator(".monaco-menu-container")).toContainText(
    en ? "Copy" : "复制",
  );
  await page.keyboard.press("Escape");

  const diagnostic = await page.evaluate(async (file) => {
    const plan = await window.mardikor!.invoke("planPublication", file, "epub");
    return plan.report.issues.find((issue) => issue.code === "E_ANCHOR_MISSING")
      ?.message;
  }, file);
  expect(diagnostic).toContain(
    en ? "Heading anchor not found" : "找不到标题锚点",
  );

  await app.evaluate(({ dialog }) => {
    dialog.showOpenDialog = async (_window, options) => {
      (
        globalThis as typeof globalThis & { localeFilters?: string[] }
      ).localeFilters = options.filters?.map((item) => item.name);
      return { canceled: true, filePaths: [] };
    };
  });
  await page
    .getByRole("button", {
      name: en ? "Open Project" : "打开工程",
      exact: true,
    })
    .click();
  await expect
    .poll(() =>
      app.evaluate(
        () =>
          (globalThis as typeof globalThis & { localeFilters?: string[] })
            .localeFilters,
      ),
    )
    .toContain(en ? "Markdown Files" : "Markdown 文件");

  await page
    .getByRole("button", { name: en ? "Settings" : "应用设置", exact: true })
    .click();
  const language = page.getByRole("combobox", {
    name: en ? "App Language" : "应用语言",
    exact: true,
  });
  await expect(language).toHaveAttribute("data-value", saved);
  if (en) {
    await page.getByText("Command-Line Guide", { exact: true }).click();
    await expect(
      page.getByRole("region", { name: "Full Command-Line Guide" }),
    ).toContainText("Input and package limits");
  }
  if (next) {
    await selectOption(page, language, next);
    await page
      .getByRole("button", {
        name: en ? "Save Preferences" : "保存偏好",
        exact: true,
      })
      .click();
    await expect
      .poll(() => new AppState(profile).preferences().language)
      .toBe(next);
    await expect(page.locator(".toast")).toContainText(
      en ? "Restart the app" : "重启应用后生效",
    );
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
  }
}

for (const [system, locale, saved, next] of [
  ["fr-FR", "en", "system", "zh-CN"],
  ["fr-FR", "zh-CN", "zh-CN", "en"],
  ["zh-CN", "en", "en", "system"],
  ["zh-Hans-SG", "zh-CN", "system", undefined],
] as const) {
  const app = await launch(system);
  try {
    await check(app, locale, saved, next);
  } finally {
    await app.close();
  }
}
console.log(
  "System fallback, explicit preferences, restart, Monaco, dialog filters, worker diagnostics and the built-in guide passed in both locales.",
);
