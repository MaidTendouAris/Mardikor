import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import AdmZip from "adm-zip";
import { selectOption } from "./select-option.mjs";

const packaged = process.env.MARDIKOR_TEST_EXECUTABLE;
const root = path.resolve(
  packaged ? ".test-artifacts/desktop-packaged" : ".test-artifacts/desktop",
);
await fs.mkdir(root, { recursive: true });
const userData = await fs.mkdtemp(path.join(root, "user-data-"));
const projectPath = path.join(root, `smoke-${Date.now()}.mdk`);
const exportPath = projectPath.replace(".mdk", "-export.mdk");
const resourcePath = path.join(root, "cover.png");
await fs.writeFile(
  resourcePath,
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1cAAAAASUVORK5CYII=",
    "base64",
  ),
);
const environment = {
  ...process.env,
  MARDIKOR_USER_DATA: userData,
  MARDIKOR_HEADLESS: "1",
};
delete environment.ELECTRON_RUN_AS_NODE;
delete environment.VITE_DEV_SERVER_URL;
const application = await electron.launch({
  ...(process.env.MARDIKOR_TEST_EXECUTABLE
    ? {
        executablePath: process.env.MARDIKOR_TEST_EXECUTABLE,
        args: ["--disable-gpu"],
      }
    : { args: ["."] }),
  env: environment,
  timeout: 30000,
});
const errors = [];
let page;
async function capture(name) {
  // Visual QA uses the development executable; packaged hidden windows may not produce frames.
  if (!packaged) await page.screenshot({ path: path.join(root, name) });
}
try {
  await application.evaluate(
    ({ dialog }, options) => {
      const saves = [options.projectPath, options.exportPath];
      const opens = [options.resourcePath];
      dialog.showSaveDialog = async () => ({
        canceled: false,
        filePath: saves.shift(),
      });
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [opens.shift()],
      });
      dialog.showMessageBoxSync = () => 1;
    },
    { projectPath, exportPath, resourcePath },
  );
  page = await application.firstWindow();
  page.setDefaultTimeout(30000);
  await application.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows())
      window.webContents.setBackgroundThrottling(false);
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await expect(
    page.getByRole("heading", { name: "工程", exact: true }),
  ).toBeVisible();
  await capture("01-home.png");
  const isolated = await page.evaluate(
    () =>
      typeof window.require === "undefined" &&
      typeof window.process === "undefined" &&
      typeof window.mardikor?.invoke === "function",
  );
  expect(isolated).toBe(true);
  const rejected = await page.evaluate(async () => {
    try {
      await window.mardikor.invoke("open", "C:/not-approved.mdk");
      return false;
    } catch {
      return true;
    }
  });
  expect(rejected).toBe(true);
  await page.getByRole("button", { name: "应用设置", exact: true }).click();
  await page.getByRole("switch").uncheck();
  await page.getByRole("button", { name: "保存偏好", exact: true }).click();
  await page.getByRole("button", { name: "工程", exact: true }).click();
  await page.getByRole("button", { name: "创建新工程" }).click();
  const editor = page.locator(".document-body");
  const code = page.getByRole("textbox", { name: /源码编辑器/ });
  const setSource = async (value) => {
    await application.evaluate(
      ({ clipboard }, text) => clipboard.writeText(text),
      value,
    );
    await code.focus();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.press("ControlOrMeta+v");
    await expect(page.locator(".document-title")).toContainText("未保存");
  };
  await expect(code).toBeVisible();
  await setSource("# 迁移后的第一章\n\nElectron、React 与 TypeScript 7。");
  await page
    .getByRole("button", { name: "保存", exact: false })
    .filter({ hasText: "Ctrl S" })
    .click();

  await expect(page.locator(".document-title")).toContainText("已保存");
  await capture("02-editor.png");
  await code.focus();
  await page.keyboard.press("ControlOrMeta+f");
  await expect(page.locator(".monaco-editor .find-widget")).toBeVisible();
  await page.keyboard.press("Escape");
  const zip = new AdmZip((await fs.readFile(projectPath)).subarray(2));
  expect(zip.readAsText("markdown/001.md")).toContain("迁移后的第一章");
  await page.getByRole("button", { name: "新建文稿", exact: true }).click();
  await page.getByRole("textbox", { name: "新建文稿" }).fill("第二章.md");
  await page.getByRole("button", { name: "创建文稿", exact: true }).click();
  await expect(page.locator(".document-title")).toContainText("第二章.md");
  const mixedSource = "# 混合换行保留\r\n\r\n第一段。\n\n第二段。\r\n";
  await page.evaluate(
    ({ file, text }) =>
      window.mardikor.invoke("saveText", file, "markdown/001.md", text),
    { file: projectPath, text: mixedSource },
  );
  await page.locator('.project-tree-row[data-path="markdown/001.md"]').click();
  await expect(page.locator(".monaco-source .view-lines")).toContainText(
    "混合换行保留",
  );
  await expect(page.locator(".document-title")).toContainText("已保存");
  await page
    .locator('.project-tree-row[data-path="markdown/第二章.md"]')
    .click();
  expect(
    new AdmZip((await fs.readFile(projectPath)).subarray(2)).readAsText(
      "markdown/001.md",
    ),
  ).toBe(mixedSource);
  const controlSnapshot = await page.evaluate(
    (file) => window.mardikor.invoke("open", file),
    projectPath,
  );
  const secondId = controlSnapshot.contents.entries.find(
    (e) => e.path === "markdown/第二章.md",
  ).id;
  await page
    .locator('.project-tree-row[data-path="markdown/第二章.md"]')
    .dragTo(page.locator('.project-tree-row[data-path="markdown/001.md"]'), {
      targetPosition: { x: 120, y: 15 },
    });
  await expect
    .poll(
      async () =>
        (
          await page.evaluate(
            (file) => window.mardikor.invoke("open", file),
            projectPath,
          )
        ).contents.entries.find((e) => e.id === secondId)?.position,
    )
    .toBe("1.1");
  await capture("07-outline-hierarchy.png");
  await page
    .getByRole("button", { name: "操作 第二章.md", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "减少层级", exact: true }).click();
  await expect
    .poll(
      async () =>
        (
          await page.evaluate(
            (file) => window.mardikor.invoke("open", file),
            projectPath,
          )
        ).contents.entries.find((e) => e.id === secondId)?.position,
    )
    .toBe("2");
  await page.getByRole("button", { name: "导入资源", exact: true }).click();
  await expect(page.locator('.toast[role="status"]')).toContainText(
    "cover.png",
  );
  await page.getByRole("tab", { name: "源码", exact: true }).click();
  await setSource(
    "# 第二章\n\n:::note\n扩展语法应原样保留。\n:::\n\n![封面](../resources/image/cover.png)\n",
  );
  await page.getByRole("button", { name: "保存源码", exact: true }).click();
  await capture("03-source.png");
  await page
    .getByRole("button", { name: "切换源码与预览分栏", exact: true })
    .click();
  await expect(page.locator(".inline-preview .mdk-note")).toBeVisible();
  await capture("09-split-preview.png");
  await page
    .getByRole("button", { name: "切换源码与预览分栏", exact: true })
    .click();
  await page.getByRole("tab", { name: "预览", exact: true }).click();
  await expect(page.locator(".preview-body .mdk-note")).toContainText(
    "扩展语法应原样保留",
  );
  await expect(page.locator(".preview-body img")).toHaveAttribute(
    "src",
    /^data:image\/png/,
  );
  await capture("04-preview.png");
  await page.getByRole("tab", { name: "可视化", exact: true }).click();
  await expect(
    page.getByText("此文稿含扩展语法", { exact: false }),
  ).toBeVisible();
  await expect(editor).toHaveAttribute("contenteditable", "false");
  await page.getByRole("tab", { name: "工程设置", exact: true }).click();
  await page.getByLabel("字号", { exact: true }).fill("18");
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await page
    .getByRole("button", { name: "编辑 settings.toml", exact: true })
    .click();
  await expect(page.locator(".monaco-source .view-lines")).toContainText(
    "font_size = 18",
  );
  await page.getByRole("tab", { name: "源码", exact: true }).click();
  await page.getByRole("tab", { name: "整体目录", exact: true }).click();
  await page.locator('.project-tree-row[data-path="contents.toml"]').click();
  const control = (
    await page.evaluate(
      (file) => window.mardikor.invoke("readText", file, "contents.toml"),
      projectPath,
    )
  ).content;
  await setSource("schema_version = 2");
  await page.getByRole("tab", { name: "工程设置", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".monaco-source .view-lines")).toContainText(
    "schema_version = 2",
  );
  await page.getByRole("button", { name: "保存源码", exact: true }).click();
  await expect(page.locator('.toast[role="alert"]')).toContainText(
    "schema_version",
  );
  await expect(page.locator(".monaco-source .view-lines")).toContainText(
    "schema_version = 2",
  );
  await setSource(control + "\n# Monaco source roundtrip\n");
  await page.getByRole("button", { name: "保存源码", exact: true }).click();
  await expect(page.locator(".document-title")).toContainText("已保存");
  await expect(page.locator('.toast[role="alert"]')).toHaveCount(0);
  await capture("08-file-explorer.png");
  await page.getByRole("tab", { name: "文稿目录", exact: true }).click();
  await page.getByRole("button", { name: "操作 001.md", exact: true }).click();
  await page.getByRole("menuitem", { name: "下移", exact: true }).click();
  await expect(page.locator(".monaco-source .view-lines")).toContainText(
    "markdown/第二章.md",
  );
  await expect
    .poll(async () => {
      const text = await page.locator(".monaco-source .view-lines").innerText();
      return (
        text.indexOf("markdown/第二章.md") < text.indexOf("markdown/001.md")
      );
    })
    .toBe(true);
  await page.getByRole("button", { name: "操作 001.md", exact: true }).click();
  await page.getByRole("menuitem", { name: "上移", exact: true }).click();
  await expect(page.locator(".editor-workspace")).not.toHaveClass(/is-busy/);
  await page.getByRole("tab", { name: "整体目录", exact: true }).click();
  await page.getByRole("button", { name: "新建文本文件", exact: true }).click();
  await page
    .getByRole("textbox", { name: "新建文本文件", exact: true })
    .fill("meta/annotations.json");
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await expect(page.locator(".document-title")).toContainText(
    "meta/annotations.json",
  );
  await expect(page.locator(".editor-workspace")).not.toHaveClass(/is-busy/);
  await setSource('{"comments":[{"text":"批注"}]}');
  await page.getByRole("button", { name: "保存源码", exact: true }).click();
  await expect(page.locator(".document-title")).toContainText("已保存");
  await expect(
    page.locator('.project-tree-row[data-path="meta/annotations.json"]'),
  ).toBeVisible();
  await selectOption(page, page.getByLabel("工程模式", { exact: true }), "02");
  await page.getByRole("tab", { name: "工程设置", exact: true }).click();
  await selectOption(page, page.getByLabel("阅读方向", { exact: true }), "rtl");
  await selectOption(
    page,
    page.getByLabel("页面排列", { exact: true }),
    "double",
  );
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await page.locator('.project-tree-row[data-path="contents.toml"]').click();
  const comicControl = (
    await page.evaluate(
      (file) => window.mardikor.invoke("readText", file, "contents.toml"),
      projectPath,
    )
  ).content;
  await setSource(
    comicControl +
      '\n[[entries]]\nid="smoke-duplicate"\npath="markdown/001.md"\nposition="6.1"\n',
  );
  await page.getByRole("button", { name: "保存源码", exact: true }).click();
  await page.getByRole("tab", { name: "预览", exact: true }).click();
  await expect(page.locator(".reading-unit")).toHaveCount(3);
  await expect(page.locator(".reading-spread.rtl")).toHaveCount(2);
  await expect(
    page.locator(".reading-spread").last().locator(".reading-unit"),
  ).toHaveCount(1);
  await expect(page.locator(".reading-unit").first()).toContainText(
    "混合换行保留",
  );
  await expect(page.locator(".reading-unit").last()).toContainText(
    "混合换行保留",
  );
  const firstBox = await page.locator(".reading-unit").nth(0).boundingBox(),
    secondBox = await page.locator(".reading-unit").nth(1).boundingBox();
  expect(firstBox.x).toBeGreaterThan(secondBox.x);
  await capture("11-comic-markdown-spreads.png");
  await page.getByRole("tab", { name: "源码", exact: true }).click();
  await setSource(comicControl);
  await page.getByRole("button", { name: "保存源码", exact: true }).click();
  await selectOption(page, page.getByLabel("工程模式", { exact: true }), "01");
  await page
    .locator('.project-tree-row[data-path="resources/image/cover.png"]')
    .click();
  await expect(page.locator(".image-pages img")).toBeVisible();
  await expect(page.locator(".source-workspace")).toBeHidden();
  await capture("10-resource-preview.png");
  await page.locator('.project-tree-row[data-path="markdown/001.md"]').click();
  await page.getByRole("tab", { name: "工程设置", exact: true }).click();
  await page.getByLabel("启用按标题拆分", { exact: true }).check();
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await page.getByRole("tab", { name: "源码", exact: true }).click();
  await setSource("# 拆分第一章\n\n第一段。\n\n# 拆分第二章\n\n第二段。\n");
  await page.getByRole("button", { name: "按标题拆分", exact: true }).click();
  await page.getByRole("button", { name: "保存并拆分", exact: true }).click();
  await expect(page.locator('.toast[role="status"]')).toContainText(
    "已拆分为 2 篇文稿",
  );
  await expect(
    page.locator('.project-tree-row[data-path="markdown/001-2.md"]'),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "操作 001-2.md", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "删除", exact: true }).click();
  await page.getByRole("button", { name: "删除", exact: true }).last().click();
  await expect(
    page.locator('.project-tree-row[data-path="markdown/001-2.md"]'),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "校验与导出", exact: true }).click();
  await page.getByRole("button", { name: "校验工程", exact: true }).click();
  await expect(page.getByText("工程校验通过", { exact: true })).toBeVisible();
  await capture("05-delivery.png");
  await page.getByRole("button", { name: "导出 .mdk", exact: true }).click();
  await expect(page.locator('.toast[role="status"]')).toContainText(
    "工程已导出",
  );
  expect((await fs.stat(exportPath)).size).toBeGreaterThan(100);
  await page.getByRole("button", { name: "应用设置", exact: true }).click();
  await page.getByRole("spinbutton", { name: "保存间隔" }).fill("5");
  await page.getByRole("spinbutton", { name: "目录实时同步阈值" }).fill("1");
  await page.getByRole("button", { name: "保存偏好", exact: true }).click();
  await expect(page.locator('.toast[role="status"]')).toContainText(
    "应用设置已保存",
  );
  await capture("06-preferences.png");
  const preferences = await page.evaluate(() => window.mardikor.preferences());
  expect(preferences.autosaveInterval).toBe(5);
  await page.getByRole("button", { name: "编辑器", exact: true }).click();
  await page.locator('.project-tree-row[data-path="contents.toml"]').click();
  await page.getByRole("tab", { name: "文稿目录", exact: true }).click();
  await page.getByRole("button", { name: "操作 001.md", exact: true }).click();
  await page.getByRole("menuitem", { name: "下移", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "目录有待同步变更", exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("目录有待同步变更，源码显示上次保存的版本。", {
      exact: false,
    }),
  ).toBeVisible();
  let positions = new AdmZip(
    (await fs.readFile(projectPath)).subarray(2),
  ).readAsText("contents.toml");
  expect(positions.indexOf("markdown/001.md")).toBeLessThan(
    positions.indexOf("markdown/第二章.md"),
  );
  await page
    .getByRole("button", { name: "目录有待同步变更", exact: false })
    .click();
  await expect(
    page.getByRole("button", { name: "目录有待同步变更", exact: false }),
  ).toHaveCount(0);
  positions = new AdmZip(
    (await fs.readFile(projectPath)).subarray(2),
  ).readAsText("contents.toml");
  expect(positions.indexOf("markdown/001.md")).toBeGreaterThan(
    positions.indexOf("markdown/第二章.md"),
  );
  await page.locator('.project-tree-row[data-path="markdown/001.md"]').click();
  await page.getByRole("button", { name: "应用设置", exact: true }).click();
  await page.getByRole("switch").check();
  await page.getByRole("button", { name: "保存偏好", exact: true }).click();
  await page.getByRole("button", { name: "编辑器", exact: true }).click();
  await setSource("# 自动保存验证\n\n未按下保存按钮。");
  await expect
    .poll(
      async () =>
        new AdmZip((await fs.readFile(projectPath)).subarray(2)).readAsText(
          "markdown/001.md",
        ),
      { timeout: 12000 },
    )
    .toContain("自动保存验证");
  await expect(page.locator(".document-title")).toContainText("已保存");
  expect(errors).toEqual([]);
  const preferencesFile = JSON.parse(
    await fs.readFile(path.join(userData, "workspace.json"), "utf8"),
  );
  expect(preferencesFile.recent).toHaveLength(1);
  await page.getByRole("tab", { name: "整体目录", exact: true }).click();
  await page.getByLabel("搜索工程目录", { exact: true }).fill("settings.toml");
  await page
    .getByRole("button", { name: "操作 settings.toml", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "删除", exact: true }).click();
  await page.getByRole("button", { name: "删除", exact: true }).last().click();
  await page.getByLabel("搜索工程目录", { exact: true }).fill("");
  await page.getByRole("tab", { name: "工程设置", exact: true }).click();
  await expect(page.getByLabel("字号", { exact: true })).toHaveValue("16");
  await page.getByLabel("字号", { exact: true }).fill("17");
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect
    .poll(
      async () =>
        (
          await page.evaluate(
            (file) => window.mardikor.invoke("open", file),
            projectPath,
          )
        ).settings.appearance.font_size,
    )
    .toBe(17);
  const unpacked = path.join(root, `unpacked-${Date.now()}`),
    repacked = path.join(root, `repacked-${Date.now()}.mdk`);
  await fs.mkdir(unpacked, { recursive: true });
  await application.evaluate(
    ({ dialog }, options) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [options.unpacked],
      });
      dialog.showSaveDialog = async () => ({
        canceled: false,
        filePath: options.repacked,
      });
    },
    { unpacked, repacked },
  );
  await page.getByRole("button", { name: "校验与导出", exact: true }).click();
  await page.getByRole("button", { name: "解包工程目录", exact: true }).click();
  await expect(page.locator('.toast[role="status"]')).toContainText(
    "工程已解包",
  );
  expect(await fs.readFile(path.join(unpacked, ".mdk-mode"), "utf8")).toBe(
    "01",
  );
  await page.getByRole("button", { name: "工程", exact: true }).click();
  await page.getByRole("button", { name: "从目录打包", exact: true }).click();
  await expect(page.locator(".project-heading")).toContainText(
    path.basename(repacked, ".mdk"),
  );
  expect(
    new AdmZip((await fs.readFile(repacked)).subarray(2)).readAsText(
      "markdown/001.md",
    ),
  ).toContain("自动保存验证");
  console.log(
    "Desktop smoke passed: isolated IPC, Monaco editing/find, hierarchy drag, bidirectional TOML sync, file explorer/JSON, split preview, media, book splitting, validation, export, pack/unpack, preferences, deferred outline sync and autosave.",
  );
} catch (error) {
  console.error(
    "Desktop failure details:",
    await page
      ?.locator(".monaco-source .view-lines")
      .innerText()
      .catch(() => ""),
    await page?.locator(".toast").allTextContents(),
  );
  await capture("99-failure.png").catch(() => {});
  throw error;
} finally {
  await page?.evaluate(() => window.mardikor.setDirty(false)).catch(() => {});
  await application.close();
}

const reopened = await electron.launch({
  ...(packaged
    ? { executablePath: packaged, args: ["--disable-gpu", projectPath] }
    : { args: [".", projectPath] }),
  env: environment,
  timeout: 30000,
});
try {
  const page = await reopened.firstWindow();
  await expect(page.locator(".project-heading")).toContainText(
    path.basename(projectPath, ".mdk"),
  );
  await expect(page.locator(".document-title")).toContainText("第二章.md");
  console.log("Startup file opening and persisted recent project passed.");
} finally {
  await reopened.close();
}
