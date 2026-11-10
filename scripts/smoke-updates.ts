import { _electron as electron, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { AppState } from "../electron/state";
import { createMdkProject, readMdkTextFile } from "../electron/mdk";

const executablePath = process.env.MARDIKOR_TEST_EXECUTABLE;
const root = path.resolve(
  `.test-artifacts/updates-${executablePath ? "packaged" : "desktop"}`,
);
await fs.mkdir(root, { recursive: true });
const run = await fs.mkdtemp(path.join(root, "run-"));
const profile = path.join(run, "profile"),
  firstFile = path.join(run, "first.md"),
  secondFile = path.join(run, "second.mdk");
const original = "# 更新前的 Markdown\n\n原始内容\n";
await fs.writeFile(firstFile, original);
createMdkProject(secondFile, "00");
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
const app = await electron.launch({
  ...(executablePath
    ? { executablePath, args: ["--disable-gpu", firstFile, secondFile] }
    : { args: [".", firstFile, secondFile] }),
  env,
  timeout: 30000,
});
type Qa = {
  checks: number;
  downloads: number;
  installs: number;
  installOptions?: [boolean | undefined, boolean | undefined];
  finish?: () => void;
  dialogs: string[];
};
const errors: string[] = [];
async function append(page: Page, text: string) {
  await page.getByRole("tab", { name: "源码", exact: true }).click();
  await page.getByRole("textbox", { name: "源码编辑器", exact: true }).focus();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText("\n\n" + text);
  await expect(page.locator(".monaco-source .view-lines")).toContainText(text);
}
try {
  await expect.poll(() => app.windows().length).toBe(2);
  const pages = app.windows();
  for (const page of pages) {
    page.on("pageerror", (error) => errors.push(error.message));
    await expect(page.locator(".document-title")).not.toContainText(
      "未选择文件",
    );
  }
  const first = (
    await pages[0].locator(".document-title").textContent()
  )?.includes("first.md")
    ? pages[0]
    : pages[1];
  const second = pages.find((page) => page !== first)!;
  await append(first, "第一窗口更新前的更改");
  await append(second, "第二窗口更新前的更改");
  await app.evaluate(({ app, dialog }) => {
    const requireModule = process
      .getBuiltinModule("module")
      .createRequire(app.getAppPath() + "/package.json");
    const client = requireModule("electron-updater").autoUpdater;
    const scope = globalThis as typeof globalThis & { updateQa: Qa };
    scope.updateQa = { checks: 0, downloads: 0, installs: 0, dialogs: [] };
    if (client.autoDownload || client.autoInstallOnAppQuit)
      throw Error("Automatic download/install must be disabled");
    client.checkForUpdates = async () => {
      scope.updateQa.checks++;
      client.emit("update-available", {
        version: "0.1.1",
        releaseNotes:
          scope.updateQa.checks === 1
            ? [
                "## 测试版本说明",
                "",
                "- **更新**与 `命令`",
                "- [项目文档](/MaidTendouAris/Mardikor#readme)",
                "",
                "<script>window.testUnsafe = true</script>",
              ].join("\n")
            : '<h2>订阅源说明</h2><ul><li><em>更新</em></li></ul>' +
              '<a href="javascript:window.testUnsafe=true" onclick="window.testUnsafe=true">不安全链接</a>' +
              '<img src="https://example.invalid/image.png"><script>window.testUnsafe=true</script>',
      });
      return { updateInfo: { version: "0.1.1" } };
    };
    client.downloadUpdate = async () => {
      scope.updateQa.downloads++;
      client.emit("download-progress", { percent: 42 });
      await new Promise<void>((resolve) => {
        scope.updateQa.finish = () => {
          client.emit("update-downloaded", { version: "0.1.1" });
          resolve();
        };
      });
      return [];
    };
    client.quitAndInstall = (silent, restart) => {
      scope.updateQa.installs++;
      scope.updateQa.installOptions = [silent, restart];
    };
    dialog.showMessageBox = async (_parent, options) => {
      scope.updateQa.dialogs.push(options.message);
      return { response: 2, checkboxChecked: false };
    };
  });
  const counts = () =>
    app.evaluate(() => ({
      ...(globalThis as typeof globalThis & { updateQa: Qa }).updateQa,
      finish: undefined,
    }));
  await first.getByRole("button", { name: "应用设置", exact: true }).click();
  await first
    .getByRole("switch", { name: "每日自动检查更新", exact: true })
    .uncheck();
  await first.getByRole("button", { name: "保存偏好", exact: true }).click();
  expect(
    await first.evaluate(
      async () => (await window.mardikor!.preferences()).autoCheckUpdates,
    ),
  ).toBe(false);
  expect((await counts()).downloads).toBe(0);
  await first
    .getByRole("button", { name: "立即检查更新", exact: true })
    .click();
  await expect(first.getByLabel("更新状态", { exact: true })).toContainText(
    "0.1.1",
  );
  await expect(
    second.getByLabel("发现应用更新", { exact: true }),
  ).toBeVisible();
  expect((await counts()).downloads).toBe(0);
  expect((await counts()).installs).toBe(0);
  await first.getByText("版本说明", { exact: true }).click();
  const notes = first.locator(".update-notes-content");
  await expect(notes.getByRole("heading", { name: "测试版本说明" })).toBeVisible();
  await expect(notes.locator("li strong")).toHaveText("更新");
  await expect(notes.locator("li code")).toHaveText("命令");
  await expect(notes.getByRole("link", { name: "项目文档" })).toHaveAttribute(
    "href",
    "https://github.com/MaidTendouAris/Mardikor#readme",
  );
  await expect(notes.locator("script")).toHaveCount(0);
  await first.getByRole("button", { name: "立即检查更新", exact: true }).click();
  await expect(notes.locator("h2")).toHaveText("订阅源说明");
  if ((await first.locator(".update-settings .update-notes").getAttribute("open")) === null)
    await first.getByText("版本说明", { exact: true }).click();
  await expect(notes.getByRole("heading", { name: "订阅源说明" })).toBeVisible();
  await expect(notes.locator("li em")).toHaveText("更新");
  await expect(notes.locator("a")).toHaveText("不安全链接");
  await expect(notes.locator("[href], [onclick], img, script")).toHaveCount(0);
  expect(
    await first.evaluate(
      () => (window as unknown as { testUnsafe?: boolean }).testUnsafe,
    ),
  ).toBeUndefined();
  if (executablePath) {
    await first.getByRole("button", { name: "下载更新", exact: true }).click();
    await expect(
      first.getByLabel("更新下载进度", { exact: true }),
    ).toHaveAttribute("value", "42");
    await app.evaluate(() =>
      (globalThis as typeof globalThis & { updateQa: Qa }).updateQa.finish!(),
    );
    await expect(
      first.getByRole("button", { name: "安装并重启", exact: true }),
    ).toBeEnabled();
    expect((await counts()).installs).toBe(0);
    await first
      .getByRole("button", { name: "安装并重启", exact: true })
      .click();
    await expect(first.getByLabel("更新状态", { exact: true })).toContainText(
      "已取消安装",
    );
    expect((await counts()).installs).toBe(0);
    expect(app.windows()).toHaveLength(2);
    expect(await fs.readFile(firstFile, "utf8")).toBe(original);
    await app.evaluate(({ dialog }) => {
      let step = 0;
      dialog.showMessageBox = async (_parent, options) => {
        (
          globalThis as typeof globalThis & { updateQa: Qa }
        ).updateQa.dialogs.push(options.message);
        return { response: step++ === 0 ? 1 : 2, checkboxChecked: false };
      };
      dialog.showMessageBoxSync = () => 2;
    });
    await first
      .getByRole("button", { name: "安装并重启", exact: true })
      .click();
    await expect.poll(async () => (await counts()).dialogs.length).toBe(3);
    await expect(first.getByLabel("更新状态", { exact: true })).toContainText(
      "已取消安装",
    );
    // Discard in the first window followed by cancel in the second must not
    // disable the first window's normal unsaved-change close guard.
    await first.getByRole("button", { name: "关闭窗口", exact: true }).click();
    expect(first.isClosed()).toBe(false);
    expect(app.windows()).toHaveLength(2);
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async (_parent, options) => {
        (
          globalThis as typeof globalThis & { updateQa: Qa }
        ).updateQa.dialogs.push(options.message);
        return { response: 0, checkboxChecked: false };
      };
    });
    // A stale document must cancel installation, keeping all windows open.
    await fs.writeFile(firstFile, original + "\n其他进程的修改");
    await first
      .getByRole("button", { name: "安装并重启", exact: true })
      .click();
    await expect(first.locator('.toast[role="alert"]')).toContainText("冲突");
    await expect(first.getByLabel("更新状态", { exact: true })).toContainText(
      "已取消安装",
    );
    expect((await counts()).installs).toBe(0);
    expect(app.windows()).toHaveLength(2);
    await fs.writeFile(firstFile, original);
    await first
      .getByRole("button", { name: "安装并重启", exact: true })
      .click();
    await expect.poll(async () => (await counts()).installs).toBe(1);
    expect((await counts()).installOptions).toEqual([true, true]);
    expect(await fs.readFile(firstFile, "utf8")).toContain(
      "第一窗口更新前的更改",
    );
    expect(readMdkTextFile(secondFile, "markdown/001.md").content).toContain(
      "第二窗口更新前的更改",
    );
    expect((await counts()).downloads).toBe(1);
    expect(
      (await counts()).dialogs.some((text) => text.includes("second.mdk")),
    ).toBe(true);
    console.log(
      "Manual download, multi-window notification, cancel/save-conflict protection and save-all-before-install passed without running an installer.",
    );
  } else {
    await expect(
      first.getByRole("button", { name: "下载更新", exact: true }),
    ).toHaveCount(0);
    await expect(
      first.getByRole("button", { name: "查看发布页", exact: true }),
    ).toBeEnabled();
    console.log(
      "Update preferences, manual checks, shared notifications, escaped notes and development-mode release link passed.",
    );
  }
  expect(errors).toEqual([]);
} finally {
  for (const page of app.windows())
    await page.evaluate(() => window.mardikor?.setDirty(false)).catch(() => {});
  await app.close();
}
