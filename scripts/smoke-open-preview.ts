import { _electron as electron, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { AppState } from "../electron/state";
import { selectOption } from "./select-option.mjs";
import { createMdkProject, saveMdkTextFile } from "../electron/mdk";

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
  archive = path.join(run, "直接打开.mdk");
await fs.writeFile(
  markdown,
  "# Markdown 预览\n\n## 文档标题\n\n直接打开文件进入预览。\n",
  "utf8",
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
  await expect(page!.locator(".document-title")).toContainText(
    "markdown/001.md",
  );
  await expect(
    page!.getByRole("tab", { name: "源码", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await secondInstance(markdown);
  await preview(path.basename(markdown), "Markdown 预览");
  await page!.evaluate(() => window.mardikor!.setDirty(false));
  await closeAll();
  app = await launch(archive);
  await prepare();
  await preview("markdown/001.md", "MDK 预览");
  expect(
    await Promise.all(
      [markdown, archive].map(async (file) =>
        createHash("sha256")
          .update(await fs.readFile(file))
          .digest("hex"),
      ),
    ),
  ).toEqual(hashes);
  expect(errors).toEqual([]);
  console.log(
    "Markdown/MDK external opens honor preview/source/visual preferences, including restart; in-app editing and original bytes remain intact.",
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
