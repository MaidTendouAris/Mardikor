import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { _electron as electron, expect } from "@playwright/test";
import { openMdkProject, validateMdk } from "../electron/mdk";
import { AppState } from "../electron/state";

const artifacts = path.resolve(".test-artifacts");
await fs.mkdir(artifacts, { recursive: true });
const run = await fs.mkdtemp(path.join(artifacts, "markdown-conversion-"));
const source = path.join(run, "source.md");
const chapter = path.join(run, "chapter.md");
const output = path.join(run, "converted.mdk");
const profile = path.join(run, "profile");
const prose =
  "\n\n这段内容让预览进入分页模式，测试转换后的链接能定位到尚未挂载的标题。".repeat(
    320,
  );
const original =
  "# 入口\n\n[跳到目标标题](chapter.md#目标标题)\n\n![示例](image.png)\n\n[缺失文件](absent.md)";
const second =
  "# 第二篇\n\n[返回](source.md)\n\n" + prose + "\n\n## 目标标题\n\n目标段落。";
await Promise.all([
  fs.writeFile(source, original),
  fs.writeFile(chapter, second),
  fs.copyFile(path.resolve("assets/icon.png"), path.join(run, "image.png")),
]);
const state = new AppState(profile);
state.preferences({
  ...state.preferences(),
  language: "zh-CN",
  pageLength: 4000,
});
const env = {
  ...process.env,
  MARDIKOR_USER_DATA: profile,
  MARDIKOR_HEADLESS: "offscreen",
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.VITE_DEV_SERVER_URL;
const executablePath = process.env.MARDIKOR_TEST_EXECUTABLE;
const app = await electron.launch({
  ...(executablePath ? { executablePath } : { args: ["."] }),
  env,
  timeout: 30000,
});
try {
  const home = await app.firstWindow();
  await app.evaluate(({ dialog }) => {
    dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
  });
  const convert = home.getByRole("button", {
    name: "Markdown 转 MDK",
    exact: true,
  });
  await convert.click();
  await expect(convert).toBeEnabled();
  assert.equal(app.windows().length, 1);

  await app.evaluate(
    ({ dialog }, { source, output }) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [source],
      });
      dialog.showSaveDialog = async () => ({
        canceled: false,
        filePath: output,
      });
    },
    { source, output },
  );
  const [page] = await Promise.all([
    app.waitForEvent("window"),
    convert.click(),
  ]);
  page.setDefaultTimeout(30000);
  await expect(page.locator(".titlebar-caption")).toHaveText("converted.mdk");
  await expect(page.locator(".document-title")).toContainText(
    "markdown/conversion-report.md",
  );
  await expect(
    page.locator(".preview-body").getByText("absent.md", { exact: true }),
  ).toBeVisible();
  const preview = page.locator(".reading-preview article[data-source-path]");
  await expect(preview).toHaveCount(1);
  await expect(preview).toHaveAttribute(
    "data-source-path",
    "markdown/conversion-report.md",
  );
  const project = openMdkProject(output);
  assert.deepEqual(
    project.contents.entries.map(({ path }) => path),
    [
      "markdown/conversion-report.md",
      "markdown/source.md",
      "markdown/chapter.md",
    ],
  );
  assert(
    project.files.some(({ path }) => path === "resources/image/image.png"),
  );
  const report = validateMdk(output);
  assert.equal(report.valid, true, JSON.stringify(report.issues));
  await page
    .locator('.project-tree-row[data-path="markdown/source.md"]')
    .click();
  await expect(page.locator(".document-title")).toContainText(
    "markdown/source.md",
  );
  await expect(preview).toHaveCount(1);
  await expect(preview).toHaveAttribute(
    "data-source-path",
    "markdown/source.md",
  );
  await expect(
    page.locator(".preview-body").getByText("absent.md", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "跳到目标标题", exact: true }).click();
  await expect(page.locator(".document-title")).toContainText(
    "markdown/chapter.md",
  );
  await expect(
    page.getByRole("heading", { name: "目标标题", exact: true }),
  ).toBeInViewport();
  assert.equal(await fs.readFile(source, "utf8"), original);
  assert.equal(await fs.readFile(chapter, "utf8"), second);
  console.log(
    "Markdown conversion opens a valid MDK with the report first and follows cross-document anchors.",
  );
} finally {
  await app.close();
}
