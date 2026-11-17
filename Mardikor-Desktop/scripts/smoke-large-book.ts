import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import * as mdk from "../electron/mdk";
import { AppState } from "../electron/state";

const executablePath = process.env.MARDIKOR_TEST_EXECUTABLE;
const sample = process.env.MARDIKOR_TEST_BOOK;
const root = path.resolve(".test-artifacts/large-book");
await fs.mkdir(root, { recursive: true });
const run = await fs.mkdtemp(path.join(root, "run-"));
const profile = path.join(run, "profile");
const file = path.join(run, "book.mdk");
const body = "用长篇正文验证编辑器按文稿独立加载。".repeat(60);
if (sample) await fs.copyFile(sample, file);
else {
  const project = mdk.createMdkProject(file, "01");
  mdk.applyMdkBatch(file, project.revision, {
    newEntries: Array.from({ length: 130 }, (_, index) => ({
      path: `markdown/chapter-${index}.md`,
      position: String(index + 2),
      title: index === 0 ? "32:00:00" : undefined,
      markdown:
        `# Chapter ${index}\n\n:::note\n测试说明。\n:::\n\n` +
        (body + "\n\n").repeat(index === 0 ? 2 : 19),
    })),
    writes: [],
    positions: [],
  });
}
const project = mdk.openMdkProject(file);
const documents = project.files.filter((entry) => entry.kind === "markdown");
documents.sort((a, b) => a.bytes - b.bytes);
const short = sample ? documents[0].path : "markdown/chapter-0.md";
const long = documents.at(-1)!.path;
const beforeShort = mdk.readMdkTextFile(file, short).content;
const beforeLong = mdk.readMdkTextFile(file, long).content;
if (!sample)
  expect(documents.length * beforeLong.length).toBeGreaterThan(2_000_000);
new AppState(profile).preferences({
  autosave: false,
  autosaveInterval: 30,
  directorySyncThreshold: 200,
  language: "zh-CN",
});
const env = {
  ...process.env,
  MARDIKOR_HEADLESS: "offscreen",
  MARDIKOR_USER_DATA: profile,
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
const errors: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));
const treeRow = (internalPath: string) =>
  page.locator(
    ".project-tree-row[data-path=" + JSON.stringify(internalPath) + "]",
  );
async function select(
  internalPath: string,
  searchText = path.posix.basename(internalPath, ".md"),
) {
  const search = page.getByRole("textbox", { name: "搜索工程目录" });
  await search.fill(searchText);
  await treeRow(internalPath).click();
  await expect(page.locator(".document-title")).toContainText(internalPath);
  await search.clear();
}
const visual = page.getByRole("tab", { name: "可视化", exact: true });
const rich = page.locator('.document-body[contenteditable="true"]');
try {
  await expect(
    page.getByRole("tab", { name: "文稿目录", exact: true }),
  ).toBeVisible();
  await select(short, sample ? undefined : "32:00:00");
  await visual.click();
  await expect(rich.locator("aside.mdk-note")).toBeVisible();
  await select(long);
  await expect(page.getByRole("tab", { name: "预览", exact: true }))
    .toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".preview-toc")).toHaveCount(0);
  await visual.click();
  await expect(rich.locator("aside.mdk-note")).toBeVisible();
  const paragraph = rich.locator("aside.mdk-note p").first();
  await paragraph.click();
  await page.keyboard.press("Home");
  await page.keyboard.insertText("容器内编辑验证");
  await page.keyboard.press("Control+s");
  await expect
    .poll(() => mdk.readMdkTextFile(file, long).content, { timeout: 15000 })
    .toMatch(/:::note[\s\S]*容器内编辑验证[\s\S]*:::/);
  expect(mdk.readMdkTextFile(file, short).content).toBe(beforeShort);
  expect(beforeLong.length).toBeGreaterThan(8000);
  expect(errors).toEqual([]);
  console.log(
    `Visual editing preserved and edited MDK containers in a ${documents.length}-document book, including a ${beforeLong.length}-character paged chapter.`,
  );
} finally {
  await page.evaluate(() => window.mardikor?.setDirty(false)).catch(() => {});
  await app.close();
}
