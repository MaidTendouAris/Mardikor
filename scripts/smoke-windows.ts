import { _electron as electron, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { AppState } from "../electron/state";
import { createMdkProject, readMdkTextFile } from "../electron/mdk";

const executablePath = process.env.MARDIKOR_TEST_EXECUTABLE;
const root = path.resolve(
  `.test-artifacts/windows-${executablePath ? "packaged" : "desktop"}`,
);
await fs.mkdir(root, { recursive: true });
const run = await fs.mkdtemp(path.join(root, "run-"));
const profile = path.join(run, "profile");
const a = path.join(run, "第一份.md"),
  b = path.join(run, "第二份.mdk"),
  c = path.join(run, "第三份.md");
await fs.writeFile(a, "# 第一份\n\n原始内容\n");
await fs.writeFile(c, "# 第三份\n\n原始内容\n");
createMdkProject(b, "01");
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
const binary =
  executablePath ?? (createRequire(import.meta.url)("electron") as string);
const launchArgs = executablePath ? ["--disable-gpu"] : ["."];
const app = await electron.launch({
  executablePath: binary,
  args: [...launchArgs, a, b],
  env,
  timeout: 30000,
});
const errors: string[] = [];
const prepare = (page: Page) => {
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(error.message));
};
app.on("window", prepare);
async function documentPage(title: string) {
  let found: Page | undefined;
  await expect
    .poll(
      async () => {
        for (const page of app.windows()) {
          if (
            (
              await page
                .locator(".document-title")
                .textContent({ timeout: 500 })
                .catch(() => "")
            )?.includes(title)
          ) {
            found = page;
            return true;
          }
        }
        return false;
      },
      { timeout: 30000 },
    )
    .toBe(true);
  prepare(found!);
  return found!;
}
async function append(page: Page, content: string) {
  await page.getByRole("tab", { name: "源码", exact: true }).click();
  await page.getByRole("textbox", { name: "源码编辑器", exact: true }).focus();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText("\n\n" + content);
  await expect(page.locator(".monaco-source .view-lines")).toContainText(
    content,
  );
}
const save = (page: Page) =>
  page
    .locator(".document-topbar")
    .getByRole("button", { name: /保存/ })
    .click();
async function close(page: Page) {
  const closed = page.waitForEvent("close");
  await page
    .getByRole("button", { name: "关闭窗口", exact: true })
    .click()
    .catch((error) => {
      // A native window can close before Playwright acknowledges the click.
      if (!page.isClosed()) throw error;
    });
  await closed;
}
try {
  const first = await documentPage(path.basename(a)),
    book = await documentPage("markdown/001.md");
  expect(app.windows()).toHaveLength(2);
  await expect(
    first.getByRole("tab", { name: "预览", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    book.getByRole("tab", { name: "预览", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await append(first, "第一窗口未保存内容");
  await append(book, "第二窗口独立内容");

  // Use an actual secondary OS process, as Windows file associations do.
  await promisify(execFile)(binary, [...launchArgs, c, a], {
    cwd: process.cwd(),
    env,
    windowsHide: true,
    timeout: 30000,
  });
  await expect.poll(() => app.windows().length).toBe(4);
  const third = await documentPage(path.basename(c));
  expect(
    await first.evaluate(async (file) => {
      await window.mardikor!.recent();
      return (await window.mardikor!.invoke("readText", file, "第三份.md"))
        .content;
    }, c),
  ).toContain("第三份");
  const duplicate = app
    .windows()
    .find((page) => page !== first && page !== book && page !== third)!;
  prepare(duplicate);
  await expect(duplicate.locator(".document-title")).toContainText(
    path.basename(a),
  );
  await expect(duplicate.locator(".reading-preview")).not.toContainText(
    "第一窗口未保存内容",
  );
  await expect(first.locator(".monaco-source .view-lines")).toContainText(
    "第一窗口未保存内容",
  );
  await expect(book.locator(".monaco-source .view-lines")).toContainText(
    "第二窗口独立内容",
  );
  const sessions = await app.evaluate(({ BrowserWindow }) => {
    const all = BrowserWindow.getAllWindows();
    return all.every((left, i) =>
      all.every(
        (right, j) =>
          i === j || left.webContents.session !== right.webContents.session,
      ),
    );
  });
  expect(sessions).toBe(true);

  await save(first);
  await expect
    .poll(() => fs.readFile(a, "utf8"))
    .toContain("第一窗口未保存内容");
  await append(duplicate, "重复窗口的过期编辑");
  await save(duplicate);
  await expect(duplicate.locator('.toast[role="alert"]')).toContainText(/冲突/);
  expect(await fs.readFile(a, "utf8")).not.toContain("重复窗口的过期编辑");

  // One window cannot consume another window's resource authorization.
  const image = path.join(run, "resource.png");
  await fs.writeFile(
    image,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1cAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
  }, image);
  const picked = await first.evaluate(() =>
    window.mardikor!.pickDocumentResources(),
  );
  expect(picked).not.toBeNull();
  const denied = await third.evaluate(
    async ({ file, token }) => {
      try {
        await window.mardikor!.invoke("insertResources", file, token, {
          revision: "",
          text: { path: "", content: "" },
          marker: "marker",
        });
        return "unexpected success";
      } catch (error) {
        return String(error);
      }
    },
    { file: c, token: picked!.token },
  );
  expect(denied).toContain("拖入文件授权已失效");

  // Closing a clean window must leave the two dirty windows untouched.
  await close(third);
  expect(app.windows()).toHaveLength(3);
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = () => 2;
  });
  await duplicate
    .getByRole("button", { name: "关闭窗口", exact: true })
    .click();
  expect(duplicate.isClosed()).toBe(false);
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = () => 1;
  });
  await close(duplicate);
  expect(app.windows()).toHaveLength(2);
  expect(await fs.readFile(a, "utf8")).not.toContain("重复窗口的过期编辑");

  // Save-and-close routes to the requesting renderer only.
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = () => 0;
  });
  await close(book);
  expect(app.windows()).toHaveLength(1);
  expect(readMdkTextFile(b, "markdown/001.md").content).toContain(
    "第二窗口独立内容",
  );
  await expect(first.locator(".document-title")).toContainText(
    path.basename(a),
  );

  // The macOS open-file route creates a window too; renderer reload retains it.
  const next = app.waitForEvent("window");
  await app.evaluate(
    ({ app }, file) => app.emit("open-file", { preventDefault() {} }, file),
    c,
  );
  const opened = await next;
  await expect(opened.locator(".document-title")).toContainText(
    path.basename(c),
  );
  await opened.reload();
  await expect(opened.locator(".document-title")).toContainText(
    path.basename(c),
  );
  await expect(first.locator(".document-title")).toContainText(
    path.basename(a),
  );
  expect(errors).toEqual([]);
  console.log(
    "Multi-argument startup, real secondary launch, independent edits/sessions/close, duplicate-file conflicts, resource authorization and open-file/reload passed.",
  );
} finally {
  for (const page of app.windows())
    await page.evaluate(() => window.mardikor?.setDirty(false)).catch(() => {});
  await app.close();
}
