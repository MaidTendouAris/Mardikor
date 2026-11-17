import { _electron as electron, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import * as mdk from "../electron/mdk";
import { AppState } from "../electron/state";

const executablePath = process.env.MARDIKOR_TEST_EXECUTABLE;
const root = path.resolve(
  executablePath
    ? ".test-artifacts/native-drag-packaged"
    : ".test-artifacts/native-drag-desktop",
);
await fs.mkdir(root, { recursive: true });
const userData = await fs.mkdtemp(path.join(root, "profile-"));
new AppState(userData).preferences({
  autosave: false,
  autosaveInterval: 30,
  directorySyncThreshold: 200,
});
const file = path.join(root, `native-drag-${Date.now()}.mdk`),
  second = path.join(root, `second-${Date.now()}.mdk`);
mdk.createMdkProject(file, "00");
mdk.saveMdkTextFile(
  file,
  "markdown/001.md",
  "# 图片拖入回归\n\n正文段落。\n\n## 下一节\n\n后续正文。",
);
mdk.addMdkEntry(file, "second.md");
mdk.createMdkProject(second, "00");
const image = path.join(root, "拖入图片.png"),
  unsupported = path.join(root, "unsupported.exe");
await fs.copyFile(path.resolve("assets/icon.png"), image);
await fs.writeFile(unsupported, "unsupported file");
const env = {
  ...process.env,
  MARDIKOR_USER_DATA: userData,
  MARDIKOR_HEADLESS: "1",
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
  page.on("pageerror", (error) => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().forEach((win) =>
      win.webContents.setBackgroundThrottling(false),
    ),
  );
  await expect(page.locator(".document-title")).toContainText(
    "markdown/001.md",
  );
  await page.getByRole("tab", { name: "可视化", exact: true }).click();
  await page.evaluate(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.id = "native-drag-files";
    input.hidden = true;
    document.body.append(input);
  });
  const gesture = async (
    paths: string[],
    target: string,
    terminal: "drop" | "dragleave" = "drop",
  ) => {
    await page!.locator("#native-drag-files").setInputFiles(paths);
    await page!.evaluate(
      ({ target, terminal }) => {
        const files =
          document.querySelector<HTMLInputElement>(
            "#native-drag-files",
          )!.files!;
        const transfer = new DataTransfer();
        for (const file of files) transfer.items.add(file);
        const tree = document.querySelector<HTMLElement>(".project-tree-row")!,
          body = document.querySelector<HTMLElement>(target)!;
        const sequence: [string, HTMLElement, HTMLElement | null][] = [
          ["dragenter", tree, null],
          ["dragover", tree, null],
          ["dragenter", body, tree],
          ["dragleave", tree, body],
          ["dragover", body, null],
          // External OS file drags do not dispatch dragend inside this document.
          [terminal, body, null],
        ];
        for (const [type, node, relatedTarget] of sequence) {
          const box = node.getBoundingClientRect();
          node.dispatchEvent(
            new DragEvent(type, {
              bubbles: true,
              cancelable: true,
              dataTransfer: transfer,
              clientX: box.left + Math.min(30, box.width / 2),
              clientY: box.top + Math.min(10, box.height / 2),
              relatedTarget,
            }),
          );
        }
      },
      { target, terminal },
    );
  };
  const healthy = async () => {
    await expect(page!.locator(".startup-error")).toHaveCount(0);
    await expect(page!.locator(".editor-workspace")).toBeVisible();
    expect(errors).toEqual([]);
  };
  await gesture([image], ".document-body p");
  await expect(page.locator('.toast[role="status"]')).toContainText(
    "已插入 1 个资源",
  );
  await expect(
    page.locator(".document-body img:not(.ProseMirror-separator)"),
  ).toHaveAttribute("src", /^data:image\/png/);
  await page.getByRole("tab", { name: "整体目录", exact: true }).click();
  await healthy();
  await page.getByRole("tab", { name: "文稿目录", exact: true }).click();
  await healthy();
  console.log(
    "Complete file drag across directory and editor survives tree remount.",
  );
  await gesture([image], ".document-body p", "dragleave");
  await page.getByRole("tab", { name: "整体目录", exact: true }).click();
  await healthy();
  await page.getByRole("tab", { name: "文稿目录", exact: true }).click();
  const before = await fs.readFile(file);
  await gesture([image, unsupported], ".document-body p");
  await expect(page.locator('.toast[role="alert"]')).toContainText(
    "不支持插入此类型",
  );
  expect((await fs.readFile(file)).equals(before)).toBe(true);
  await page.getByRole("tab", { name: "整体目录", exact: true }).click();
  await healthy();
  await page.getByRole("tab", { name: "文稿目录", exact: true }).click();
  await page
    .locator('.project-tree-row[data-path="markdown/second.md"]')
    .dragTo(page.locator('.project-tree-row[data-path="markdown/001.md"]'), {
      targetPosition: { x: 100, y: 15 },
    });
  await expect
    .poll(
      () =>
        mdk
          .openMdkProject(file)
          .contents.entries.find((e) => e.path === "markdown/second.md")
          ?.position,
    )
    .toBe("1.1");
  await page.locator('.project-tree-row[data-path="markdown/001.md"]').click();
  await page.getByRole("tab", { name: "可视化", exact: true }).click();
  await page
    .getByRole("button", { name: "向右拆分编辑器", exact: true })
    .click();
  await gesture([image], ".editor-group-slot:nth-child(2) .document-body p");
  await expect(page.locator('.toast[role="status"]')).toContainText(
    "已插入 1 个资源",
  );
  await expect(
    page
      .locator(".editor-group-slot")
      .first()
      .locator(".document-body img:not(.ProseMirror-separator)"),
  ).toHaveCount(2);
  await expect(
    page
      .locator(".editor-group-slot")
      .nth(1)
      .locator(".document-body img:not(.ProseMirror-separator)"),
  ).toHaveCount(2);
  await page.getByRole("tab", { name: "整体目录", exact: true }).click();
  await healthy();
  await page.getByRole("tab", { name: "文稿目录", exact: true }).click();
  await app.evaluate(({ dialog }, second) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [second],
    });
  }, second);
  await page.getByRole("button", { name: "打开工程", exact: true }).click();
  await expect(page.locator(".project-heading")).toContainText(
    path.basename(second, ".mdk"),
  );
  await healthy();
  await page.getByRole("tab", { name: "整体目录", exact: true }).click();
  await page.getByRole("tab", { name: "文稿目录", exact: true }).click();
  await healthy();
  expect(mdk.validateMdk(file).valid).toBe(true);
  await page.getByRole("textbox", { name: "源码编辑器", exact: true }).focus();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText("\n\n拖入后仍可编辑保存。");
  await page
    .locator(".document-topbar")
    .getByRole("button", { name: /保存/ })
    .click();
  await expect
    .poll(() => mdk.readMdkTextFile(second, "markdown/001.md").content)
    .toContain("拖入后仍可编辑保存");
  await expect(page.locator('.toast[role="status"]')).toContainText(
    "工程已保存",
  );
  await expect(
    page.locator(".document-topbar").getByRole("button", { name: /保存/ }),
  ).toBeEnabled();
  await healthy();
  await gesture([image], ".monaco-source .view-lines");
  await expect(page.locator('.toast[role="status"]')).toContainText(
    "已插入 1 个资源",
  );
  expect(
    mdk
      .openMdkProject(second)
      .files.some((entry) => entry.path === "resources/image/拖入图片.png"),
  ).toBe(true);
  expect(mdk.validateMdk(second).valid).toBe(true);
  await healthy();
  console.log(
    "Canceled/rejected drops, actual tree dragging, split image insertion and project replacement passed without backend conflicts.",
  );
} catch (error) {
  if (page && !executablePath)
    await page
      .screenshot({ path: path.join(root, "failure.png") })
      .catch(() => {});
  console.error("Native drag errors:", errors);
  throw error;
} finally {
  await page?.evaluate(() => window.mardikor!.setDirty(false)).catch(() => {});
  await app.close();
}
