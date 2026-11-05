import { _electron as electron, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { AppState } from "../electron/state";
import { createMdkProject } from "../electron/mdk";

const executablePath = process.env.MARDIKOR_TEST_EXECUTABLE;
const root = path.resolve(
  executablePath
    ? ".test-artifacts/markdown-file-packaged"
    : ".test-artifacts/markdown-file-desktop",
);
await fs.mkdir(root, { recursive: true });
const run = await fs.mkdtemp(path.join(root, "run-"));
const profile = path.join(run, "profile"),
  file = path.join(run, "独立文稿.MD"),
  created = path.join(run, "新建文稿.md"),
  archive = path.join(run, "existing.mdk"),
  image = path.join(run, "插入图片.png");
new AppState(profile).preferences({
  autosave: false,
  autosaveInterval: 5,
  directorySyncThreshold: 200,
});
await fs.writeFile(file, "# 单 Markdown\n\n## 第一节\n\n原始内容。\n");
await fs.copyFile(path.resolve("assets/icon.png"), image);
createMdkProject(archive, "00");
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
let app = await launch(file),
  page: Page | undefined;
const errors: string[] = [];
async function prepare() {
  page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => errors.push(e.message));
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().forEach((w) => {
      w.webContents.setBackgroundThrottling(false);
      w.setSize(1500, 1000);
    }),
  );
}
async function disabledMdk() {
  await expect(page!.getByLabel("工程模式", { exact: true })).toBeDisabled();
  await expect(
    page!.getByRole("tab", { name: "工程设置", exact: true }),
  ).toBeDisabled();
  await expect(
    page!.getByRole("button", { name: "settings.toml", exact: true }),
  ).toBeDisabled();
  await expect(
    page!.getByRole("button", { name: "contents.toml", exact: true }),
  ).toBeDisabled();
  await expect(page!.getByLabel("新建文稿", { exact: true })).toBeDisabled();
  await expect(
    page!.getByRole("button", { name: "导出", exact: true }),
  ).toBeEnabled();
  await expect(
    page!.getByRole("button", { name: "校验与导出", exact: true }),
  ).toBeEnabled();
}
const save = () =>
  page!
    .locator(".document-topbar")
    .getByRole("button", { name: /保存/ })
    .click();
async function append(text: string) {
  const sourceTab = page!
    .getByRole("tab", { name: "源码", exact: true })
    .first();
  if ((await sourceTab.getAttribute("aria-selected")) !== "true")
    await sourceTab.click();
  await page!
    .getByRole("textbox", { name: "源码编辑器", exact: true })
    .first()
    .focus();
  await page!.keyboard.press("Control+End");
  await page!.keyboard.insertText("\n\n" + text);
  await expect(
    page!.locator(".monaco-source .view-lines").first(),
  ).toContainText(text);
}
try {
  await prepare();
  await expect(page!.locator(".document-title")).toContainText(
    path.basename(file),
  );
  await expect(
    page!.getByRole("tab", { name: "预览", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await disabledMdk();
  await append("手动保存内容");
  await save();
  await expect.poll(() => fs.readFile(file, "utf8")).toContain("手动保存内容");
  await page!.getByRole("tab", { name: "可视化", exact: true }).click();
  await expect(page!.locator(".document-body h1")).toHaveText("单 Markdown");
  await expect(
    page!.getByRole("treeitem", { name: "H2 第一节", exact: true }),
  ).toBeVisible();
  await page!.evaluate(() => {
    const input = document.createElement("input");
    input.id = "local-md-file";
    input.type = "file";
    input.hidden = true;
    document.body.append(input);
  });
  await page!.locator("#local-md-file").setInputFiles(image);
  await page!.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>("#local-md-file")!,
      dataTransfer = new DataTransfer();
    dataTransfer.items.add(input.files![0]);
    const body = document.querySelector<HTMLElement>(".document-body")!,
      box = body.getBoundingClientRect();
    for (const type of ["dragenter", "dragover", "drop"])
      body.dispatchEvent(
        new DragEvent(type, {
          bubbles: true,
          cancelable: true,
          dataTransfer,
          clientX: box.x + 50,
          clientY: box.y + 50,
        }),
      );
  });
  await expect(page!.locator('.toast[role="status"]')).toContainText(
    "已插入 1 个资源",
  );
  await expect(
    page!.locator(".document-body img:not(.ProseMirror-separator)"),
  ).toHaveAttribute("src", /^data:image\/png/);
  expect(await fs.readFile(file, "utf8")).toContain("resources/image/");
  await fs.access(path.join(run, "resources/image/插入图片.png"));
  await page!.getByRole("tab", { name: "源码", exact: true }).click();
  await page!
    .getByRole("button", { name: "向右拆分编辑器", exact: true })
    .click();
  const right = page!.getByRole("region", { name: "右栏编辑组", exact: true });
  await right.getByRole("combobox", { name: "右栏文件", exact: true }).click();
  await expect(
    page!.getByRole("option", { name: "settings.toml", exact: true }),
  ).toBeDisabled();
  await page!.keyboard.press("Escape");
  await right.getByRole("tab", { name: "预览", exact: true }).click();
  await append("双栏 Markdown 同步");
  await expect(right.locator(".reading-preview")).toContainText(
    "双栏 Markdown 同步",
  );
  await save();
  await expect
    .poll(() => fs.readFile(file, "utf8"))
    .toContain("双栏 Markdown 同步");
  await page!.getByRole("button", { name: "关闭右栏", exact: true }).click();
  if (!executablePath)
    await page!.screenshot({
      path: path.join(root, "standalone-markdown.png"),
    });
  expect(
    (await fs.readdir(run)).filter((f) =>
      /\.toml$|^mimetype$|\.mdk-mode$/.test(f),
    ),
  ).toEqual([]);
  console.log(
    "Standalone Markdown startup, disabled MDK controls, save, visual outline, file drag and split preview passed.",
  );

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
    page!.getByRole("tab", { name: "工程设置", exact: true }),
  ).toBeEnabled();
  await expect(
    page!.getByRole("button", { name: "settings.toml", exact: true }),
  ).toBeEnabled();
  await page!.getByRole("button", { name: "工程", exact: true }).click();
  await page!.getByRole("radio", { name: /单 Markdown 工程/ }).check();
  await expect(
    page!.getByRole("button", { name: "从目录打包", exact: true }),
  ).toBeDisabled();
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
  }, created);
  await page!.getByRole("button", { name: "创建新工程", exact: true }).click();
  await expect(page!.locator(".document-title")).toContainText(
    path.basename(created),
  );
  await expect(
    page!.getByRole("tab", { name: "源码", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  expect(await fs.readFile(created, "utf8")).toBe("");
  await disabledMdk();
  await append("重启恢复草稿");
  await expect
    .poll(() =>
      page!.evaluate(async (file) => {
        const draft = await window.mardikor!.recovery(file);
        return draft?.text?.content ?? draft?.texts?.[0]?.content;
      }, created),
    )
    .toContain("重启恢复草稿");
  expect(await fs.readFile(created, "utf8")).toBe("");
  await page!.evaluate(() => window.mardikor!.setDirty(false));
  await app.close();
  new AppState(profile).preferences({
    autosave: true,
    autosaveInterval: 5,
    directorySyncThreshold: 200,
  });
  app = await launch(created);
  await prepare();
  await page!.getByRole("button", { name: "恢复草稿", exact: true }).click();
  await expect
    .poll(() => fs.readFile(created, "utf8"), { timeout: 15000 })
    .toContain("重启恢复草稿");
  await expect(page!.locator(".document-title")).toContainText("已保存");
  await fs.writeFile(created, "外部进程内容");
  await append("冲突缓冲保留");
  await save();
  await expect(page!.locator('.toast[role="alert"]')).toContainText("其他进程");
  expect(await fs.readFile(created, "utf8")).toBe("外部进程内容");
  await expect(page!.locator(".monaco-source .view-lines")).toContainText(
    "冲突缓冲保留",
  );
  expect(errors).toEqual([]);
  console.log(
    "MDK switching, new .md project, recovery, autosave and external-change conflict protection passed.",
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
