import { _electron as electron, expect, type Page } from "@playwright/test";
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
const launch = (target: string, data = profile) =>
  electron.launch({
    ...(executablePath
      ? { executablePath, args: ["--disable-gpu", target] }
      : { args: [".", target] }),
    env: { ...env, MARDIKOR_USER_DATA: data },
  });
const app = await launch(file);
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
  const imageBinding = page.getByRole("button", {
    name: "录制插入图片快捷键",
    exact: true,
  });
  await imageBinding.click();
  await page.keyboard.press("Control+Alt+i");
  await expect(imageBinding).toHaveText("Ctrl+Alt+I");
  const linkBinding = page.getByRole("button", {
    name: "录制插入或编辑链接快捷键",
    exact: true,
  });
  await linkBinding.click();
  await page.keyboard.press("Control+Alt+k");
  const paletteBinding = page.getByRole("button", {
    name: "录制Markdown 操作快捷键",
    exact: true,
  });
  await paletteBinding.click();
  await page.keyboard.press("Control+Shift+/");
  await expect(paletteBinding).toHaveText("Ctrl+Shift+/");
  await page
    .getByRole("button", { name: "取消绑定移除链接", exact: true })
    .click();
  await page.getByRole("button", { name: "保存快捷键", exact: true }).click();
  await expect
    .poll(() => new AppState(profile).preferences().shortcuts)
    .toEqual({
      heading1: null,
      heading2: "Ctrl+Shift+H",
      save: "Ctrl+Shift+G",
      bold: "Ctrl+Shift+D",
      image: "Ctrl+Alt+I",
      link: "Ctrl+Alt+K",
      palette: "Ctrl+Shift+/",
      unlink: null,
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

const standalone = path.join(run, "键盘独立文稿.md");
await fs.writeFile(standalone, "# 键盘验证\n\n链接文字\n\n末尾正文");
async function checkStandalone(
  check: (page: Page) => Promise<void>,
  data = profile,
) {
  const restarted = await launch(standalone, data);
  const page = await restarted.firstWindow();
  page.setDefaultTimeout(15000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await check(page);
    expect(errors).toEqual([]);
  } finally {
    await page.evaluate(() => window.mardikor!.setDirty(false)).catch(() => {});
    await restarted.close();
  }
}
const standaloneBody = (page: Page) =>
  page.locator('.document-body[contenteditable="true"]');
const actionMenu = (page: Page) =>
  page.getByRole("dialog", { name: "Markdown 操作", exact: true });
const actionSearch = (page: Page) =>
  actionMenu(page).getByRole("combobox", { name: "搜索 Markdown 操作" });

await checkStandalone(async (page) => {
  const body = standaloneBody(page);
  const ribbon = page.getByRole("toolbar", { name: "正文格式", exact: true });
  const link = page.getByRole("dialog", { name: "链接", exact: true });
  const image = page.getByRole("dialog", { name: "图片", exact: true });
  await expect(
    ribbon.getByRole("button", { name: "插入图片", exact: true }),
  ).toHaveAttribute("title", "插入图片 (Ctrl+Alt+I)");
  await expect(
    ribbon.getByRole("button", { name: "插入链接", exact: true }),
  ).toHaveAttribute("title", "插入链接 (Ctrl+Alt+K)");
  await expect(
    ribbon.getByRole("button", { name: "移除链接", exact: true }),
  ).toHaveAttribute("title", "移除链接");
  await body.getByText("链接文字", { exact: true }).click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  const selection = () => page.evaluate(() => window.getSelection()?.toString());
  await expect.poll(selection).toBe("链接文字");
  await page.keyboard.press("Control+k");
  await expect(link).toHaveCount(0);
  await expect.poll(selection).toBe("链接文字");
  await page.keyboard.press("Control+Alt+k");
  await expect(link.getByLabel("链接文字", { exact: true })).toHaveValue(
    "链接文字",
  );
  await expect(link.getByLabel("链接地址", { exact: true })).toBeFocused();
  await page.keyboard.insertText("https://example.com/keyboard");
  await page.keyboard.press("Enter");
  const anchor = body.getByRole("link", { name: "链接文字", exact: true });
  await expect(anchor).toHaveAttribute("href", "https://example.com/keyboard");
  await expect(body).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Control+Shift+k");
  await expect(anchor).toBeVisible();
  await expect(link).toHaveCount(0);
  await page.keyboard.press("Control+Alt+i");
  await expect(image).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(body).toBeFocused();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("/");
  await expect(body.getByText("末尾正文/", { exact: true })).toBeVisible();
  await page.keyboard.press("Control+/");
  await expect(actionMenu(page)).toHaveCount(0);
  await page.keyboard.press("Tab");
  await expect(body).not.toBeFocused();
  await body.getByText("末尾正文/", { exact: true }).click();

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.imeSetComposition", {
    text: "中",
    selectionStart: 1,
    selectionEnd: 1,
  });
  const protectedKeys = await body.evaluate((dom) =>
    [
      { key: "h", code: "KeyH", ctrlKey: true, shiftKey: true },
      { key: "?", code: "Slash", ctrlKey: true, shiftKey: true },
      { key: "7", code: "Digit7", ctrlKey: true, shiftKey: true },
      { key: "Enter", code: "Enter" },
    ].map((init) =>
      dom.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          ...init,
        }),
      ),
    ),
  );
  expect(protectedKeys).toEqual([true, true, true, true]);
  await expect(actionMenu(page)).toHaveCount(0);
  await cdp.send("Input.imeSetComposition", {
    text: "",
    selectionStart: 0,
    selectionEnd: 0,
  });
  await cdp.detach();
  await body.getByText("末尾正文/", { exact: true }).click();
  await page.keyboard.press("Control+Shift+h");
  await expect(body.locator("h2")).toHaveText("末尾正文/");
  const altGraphPassed = await body.evaluate((dom) => {
    const event = new KeyboardEvent("keydown", {
      key: "i",
      code: "KeyI",
      ctrlKey: true,
      altKey: true,
      bubbles: true,
      cancelable: true,
      modifierAltGraph: true,
    });
    return [event.getModifierState("AltGraph"), dom.dispatchEvent(event)];
  });
  expect(altGraphPassed).toEqual([true, true]);
  await expect(image).toHaveCount(0);
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Control+Shift+d");
  await page.keyboard.insertText("无选区加粗");
  await expect(body.locator("strong")).toHaveText("无选区加粗");
  await page.keyboard.press("Control+Shift+d");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Control+Shift+/");
  const search = actionSearch(page);
  await expect(search).toBeFocused();
  await page.keyboard.insertText("image");
  await expect(
    actionMenu(page)
      .getByRole("option", { name: /插入图片/ })
      .locator("kbd"),
  ).toHaveText("Ctrl+Alt+I");
  await search.fill("T");
  const acceptedDuringComposition = await search.evaluate((dom) => {
    dom.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    const accepted = dom.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
    dom.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true }),
    );
    return accepted;
  });
  expect(acceptedDuringComposition).toBe(true);
  await expect(actionMenu(page)).toBeVisible();
  await page.keyboard.press("Enter");
  const table = page.getByRole("dialog", { name: "插入表格", exact: true });
  await expect(table.getByLabel("行数")).toBeFocused();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText("2");
  await page.keyboard.press("Enter");
  await expect(body).toBeFocused();
  await page.keyboard.insertText("项目");
  await page.keyboard.press("Tab");
  await page.keyboard.insertText("状态");
  await page.keyboard.press("Tab");
  await page.keyboard.insertText("复习");
  await page.keyboard.press("Tab");
  await page.keyboard.insertText("完成");
  await page.keyboard.press("Control+Shift+g");
  await expect
    .poll(() => fs.readFile(standalone, "utf8"))
    .toMatch(/\| 项目\s+\| 状态\s+\|[\s\S]*\| 复习\s+\| 完成\s+\|/);
  await expect(page.locator(".save-label")).toHaveText("已保存");
});
await checkStandalone(async (page) => {
  await expect(standaloneBody(page).locator("th")).toHaveText(["项目", "状态"]);
  await expect(standaloneBody(page).locator("tr").nth(1)).toContainText("复习");
});

const legacy = path.join(run, "legacy-profile");
new AppState(legacy).preferences({
  autosave: false,
  autosaveInterval: 5,
  directorySyncThreshold: 200,
  externalOpenView: "write",
});
const legacyFile = path.join(legacy, "workspace.json");
const legacyState = JSON.parse(await fs.readFile(legacyFile, "utf8"));
legacyState.preferences.shortcuts = { heading2: "Ctrl+/", bold: null };
await fs.writeFile(legacyFile, JSON.stringify(legacyState));
await checkStandalone(async (page) => {
  const body = standaloneBody(page);
  await body.getByText("链接文字", { exact: true }).click();
  await page.keyboard.press("Control+/");
  await expect(body.locator("h2", { hasText: "链接文字" })).toBeVisible();
  await expect(actionMenu(page)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Markdown 操作", exact: true }),
  ).toHaveAttribute("title", "Markdown 操作");
}, legacy);
console.log(
  "Restarted bindings, slash recording, input composition and AltGraph, standalone table reopen, and legacy conflicts passed.",
);
