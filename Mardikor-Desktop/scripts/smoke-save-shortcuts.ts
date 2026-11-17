import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { AppState } from "../electron/state";
import * as mdk from "../electron/mdk";
import type { Editor } from "@tiptap/core";

const executablePath = process.env.MARDIKOR_TEST_EXECUTABLE;
const root = path.resolve(".test-artifacts/save-shortcuts");
await fs.mkdir(root, { recursive: true });
const run = await fs.mkdtemp(path.join(root, "run-"));
const profile = path.join(run, "profile");
const file = path.join(run, "caret.mdk");
const entry = "markdown/001.md";
new AppState(profile).preferences({
  autosave: false,
  autosaveInterval: 5,
  directorySyncThreshold: 200,
  externalOpenView: "write",
});
mdk.createMdkProject(file, "00");
mdk.saveMdkTextFile(
  file,
  entry,
  "# 光标测试\n\n甲乙丙丁\n\n" +
    "用于触发可视化编辑分页的正文。".repeat(5).concat("\n\n").repeat(140),
);

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
});
const page = await app.firstWindow();
page.setDefaultTimeout(15000);
const body = page.locator(".document-body[contenteditable]");
const saved = () => mdk.readMdkTextFile(file, entry).content.slice(0, 150);
type SaveGate = { arm: boolean; release?: () => void };
type TestMain = typeof globalThis & { saveGate: SaveGate };
try {
  // Hold a real save open so the test can type between snapshot and commit.
  await app.evaluate(({ ipcMain }) => {
    type Invoke = (
      event: Electron.IpcMainInvokeEvent,
      command: string,
      ...args: unknown[]
    ) => unknown;
    const original = (
      ipcMain as typeof ipcMain & { _invokeHandlers: Map<string, Invoke> }
    )._invokeHandlers.get("mdk:invoke")!;
    const gate = ((globalThis as TestMain).saveGate = {
      arm: false,
    } as SaveGate);
    ipcMain.removeHandler("mdk:invoke");
    ipcMain.handle("mdk:invoke", async (event, command: string, ...args) => {
      if (command === "saveSnapshot" && gate.arm) {
        gate.arm = false;
        await new Promise<void>((resolve) => {
          gate.release = resolve;
        });
        gate.release = undefined;
      }
      return original(event, command, ...args);
    });
  });
  const arm = () =>
    app.evaluate(() => {
      (globalThis as TestMain).saveGate.arm = true;
    });
  const waitForSave = () =>
    expect
      .poll(
        () => app.evaluate(() => !!(globalThis as TestMain).saveGate.release),
        { timeout: 12000 },
      )
      .toBe(true);
  const release = () =>
    app.evaluate(() => {
      (globalThis as TestMain).saveGate.release?.();
    });
  const caret = () =>
    page.evaluate(() => {
      const selection = window.getSelection();
      return [selection?.anchorNode?.textContent, selection?.anchorOffset];
    });
  const focusLine = (select = false) =>
    body.evaluate((dom, select) => {
      const editor = (dom as HTMLElement & { editor: Editor }).editor;
      const line = Array.from(dom.querySelectorAll("p")).find((node) =>
        /^甲.*乙丙丁$/.test(node.textContent ?? ""),
      )!;
      const from = editor.view.posAtDOM(line.firstChild!, 0);
      dom.focus();
      editor.commands.setTextSelection(
        select ? { from, to: from + line.textContent!.length } : from + 1,
      );
    }, select);
  const checkHeldSave = async (
    key: string | null,
    before: string,
    extra: string,
    after: string,
  ) => {
    await waitForSave();
    await expect(body).toHaveAttribute("contenteditable", "true");
    await expect(body).toBeFocused();
    await expect.poll(caret).toEqual([before, 2]);
    await page.keyboard.insertText(extra);
    await release();
    await expect.poll(saved).toContain(before);
    await expect(body).toBeFocused();
    await expect.poll(caret).toEqual([after, 3]);
    await expect
      .poll(() =>
        page.evaluate(
          async (file) =>
            (await window.mardikor!.recovery(file))?.text?.content,
          file,
        ),
      )
      .toContain(after);
    if (key) {
      await page.keyboard.press(key);
      await expect.poll(saved).toContain(after);
    }
  };
  await expect(page.locator(".paged-preview .document-body")).toBeVisible();
  await focusLine();
  await page.keyboard.insertText("A");
  await arm();
  await page.keyboard.press("Control+s");
  await checkHeldSave("Control+s", "甲A乙丙丁", "B", "甲AB乙丙丁");
  await page.keyboard.insertText("C");
  await expect(body).toContainText("甲ABC乙丙丁");

  for (const level of [1, 2, 3, 4, 5, 6]) {
    await page.keyboard.press(`Control+${level}`);
    await expect(
      body.locator(`h${level}`, { hasText: "甲ABC乙丙丁" }),
    ).toBeVisible();
    await expect(body).toBeFocused();
  }
  await page.keyboard.press("Control+0");
  await expect(body.locator("p", { hasText: "甲ABC乙丙丁" })).toBeVisible();
  await page.keyboard.press("Control+s");
  await expect.poll(saved).toContain("甲ABC乙丙丁");

  await page.getByRole("button", { name: "应用设置", exact: true }).click();
  await page.getByRole("button", { name: "配置快捷键" }).click();
  await expect(
    page.getByRole("heading", { name: "键盘快捷键", exact: true }),
  ).toBeVisible();
  const heading2 = page.getByRole("button", { name: "录制设为标题 2快捷键" });
  await heading2.click();
  await page.keyboard.press("Control+1");
  await expect(page.getByRole("alert")).toContainText("已同时分配");
  await page.keyboard.press("Control+Shift+h");
  await expect(heading2).toHaveText("Ctrl+Shift+H");
  await page
    .getByRole("button", { name: "取消绑定设为标题 1", exact: true })
    .click();
  const save = page.getByRole("button", { name: "录制保存工程快捷键" });
  await save.click();
  await page.keyboard.press("Control+Shift+g");
  const bold = page.getByRole("button", {
    name: "录制加粗快捷键",
    exact: true,
  });
  await bold.click();
  await page.keyboard.press("Control+Shift+d");
  await page.getByRole("button", { name: "保存快捷键", exact: true }).click();
  await expect
    .poll(() => new AppState(profile).preferences().shortcuts)
    .toEqual({
      heading1: null,
      heading2: "Ctrl+Shift+H",
      save: "Ctrl+Shift+G",
      bold: "Ctrl+Shift+D",
    });
  await page.getByRole("button", { name: "返回应用设置", exact: true }).click();
  await page.getByRole("button", { name: "编辑器", exact: true }).click();
  await focusLine();
  await expect.poll(caret).toEqual(["甲ABC乙丙丁", 1]);
  await page.keyboard.press("Control+1");
  await page.keyboard.press("Control+2");
  await expect(body.locator("p", { hasText: "甲ABC乙丙丁" })).toBeVisible();
  await expect.poll(caret).toEqual(["甲ABC乙丙丁", 1]);
  await page.keyboard.press("Control+Shift+h");
  await expect(body.locator("h2", { hasText: "甲ABC乙丙丁" })).toBeVisible();
  await expect.poll(caret).toEqual(["甲ABC乙丙丁", 1]);
  await page.keyboard.press("Control+0");
  await expect.poll(caret).toEqual(["甲ABC乙丙丁", 1]);
  await page.keyboard.insertText("D");
  await page.keyboard.press("Control+s");
  expect(saved()).not.toContain("甲DABC乙丙丁");
  await page.keyboard.press("Control+Shift+g");
  await expect.poll(saved).toContain("甲DABC乙丙丁");

  await page.getByRole("button", { name: "应用设置", exact: true }).click();
  await page.getByRole("switch", { name: /自动保存/ }).check();
  await page.getByRole("button", { name: "保存偏好", exact: true }).click();
  await expect
    .poll(() => new AppState(profile).preferences().autosave)
    .toBe(true);
  await page.getByRole("button", { name: "编辑器", exact: true }).click();
  await focusLine();
  await arm();
  await page.keyboard.insertText("E");
  await checkHeldSave(null, "甲EDABC乙丙丁", "F", "甲EFDABC乙丙丁");
  await page.keyboard.insertText("G");
  await expect(body).toContainText("甲EFGDABC乙丙丁");
  await page.keyboard.press("Control+Shift+g");
  await expect.poll(saved).toContain("甲EFGDABC乙丙丁");
  await focusLine(true);
  const selectedText = () =>
    page.evaluate(() => window.getSelection()?.toString());
  await expect.poll(selectedText).toBe("甲EFGDABC乙丙丁");
  await expect(body).toBeFocused();
  await page.keyboard.press("Control+b");
  await expect(body.locator("strong")).toHaveCount(0);
  await expect.poll(selectedText).toBe("甲EFGDABC乙丙丁");
  await page.keyboard.press("Control+Shift+d");
  await expect(body.locator("strong")).toHaveText("甲EFGDABC乙丙丁");
  await page.keyboard.press("Control+i");
  await expect(body.locator("em")).toHaveText("甲EFGDABC乙丙丁");
  await page.keyboard.press("Control+i");
  await page.keyboard.press("Control+Shift+d");
  await page.keyboard.press("Control+e");
  await expect(body.locator("code")).toHaveText("甲EFGDABC乙丙丁");
  await page.keyboard.press("Control+e");
  await page.keyboard.press("Control+Alt+c");
  await expect(body.locator("pre")).toContainText("甲EFGDABC乙丙丁");
  await page.keyboard.press("Control+Shift+g");
  await expect.poll(saved).toMatch(/```\s+甲EFGDABC乙丙丁/);
  console.log(
    "Manual and automatic saves preserved focus, caret and in-flight edits. Heading and custom shortcuts passed.",
  );
} finally {
  await app
    .evaluate(() => {
      (globalThis as TestMain).saveGate?.release?.();
    })
    .catch(() => {});
  await page.evaluate(() => window.mardikor!.setDirty(false)).catch(() => {});
  await app.close();
}
