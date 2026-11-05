import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import AdmZip from "adm-zip";
import * as mdk from "../electron/mdk";
import { AppState } from "../electron/state";
import { markdownHeadings } from "../shared/markdown";

const packaged = process.env.MARDIKOR_TEST_EXECUTABLE;
const root = path.resolve(
  packaged
    ? ".test-artifacts/editor-packaged"
    : ".test-artifacts/editor-desktop",
);
await fs.mkdir(root, { recursive: true });
const userData = await fs.mkdtemp(path.join(root, "profile-")),
  file = path.join(root, `editor-${Date.now()}.mdk`);
new AppState(userData).preferences({
  autosave: false,
  autosaveInterval: 30,
  directorySyncThreshold: 200,
});
const source =
  "# 文稿标题\n\n开头段落。\n\n## 第二节\n\n" +
  Array.from(
    { length: 70 },
    (_, i) => "第 " + i + " 段正文，用于检查滚动时工具栏保持在正文之外。",
  ).join("\n\n") +
  "\n\n### 最后小节\n\n末尾正文。";
let project = mdk.createMdkProject(file, "00");
mdk.saveMdkEntry(file, project.contents.entries[0].id, source);
mdk.addMdkEntry(file, "other.md");
mdk.saveMdkTextFile(
  file,
  "markdown/other.md",
  "# 另一文稿\n\n" + "正文。\n\n".repeat(20),
);
project = mdk.openMdkProject(file);
project.settings.layout.page_width = 320;
project.settings.layout.margin_left = 40;
project.settings.layout.margin_right = 40;
project.settings.preview.show_title = false;
mdk.updateMdkSettings(file, project.settings);
const image = path.join(root, "拖入图片.png"),
  bad = path.join(root, "unsupported.exe"),
  pdf = path.join(root, "attachment.pdf");
await fs.writeFile(
  image,
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1cAAAAASUVORK5CYII=",
    "base64",
  ),
);
await fs.writeFile(bad, "not supported");
await fs.writeFile(pdf, "%PDF-1.7\nattachment");
const env = {
  ...process.env,
  MARDIKOR_USER_DATA: userData,
  MARDIKOR_HEADLESS: "1",
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.VITE_DEV_SERVER_URL;
const app = await electron.launch({
  ...(packaged
    ? { executablePath: packaged, args: ["--disable-gpu", file] }
    : { args: [".", file] }),
  env,
  timeout: 30000,
});
let page;
try {
  page = await app.firstWindow();
  page.setDefaultTimeout(30000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    for (const win of BrowserWindow.getAllWindows())
      win.webContents.setBackgroundThrottling(false);
  });
  await expect(page.locator(".document-title")).toContainText(
    "markdown/001.md",
  );
  await expect(page.locator(".page-topbar")).toHaveCount(0);
  await expect(page.locator(".open-file-tabs")).toHaveCount(0);
  const headings = markdownHeadings(source),
    last = headings.at(-1)!;
  await expect(
    page
      .getByRole("tree", { name: "文内标题", exact: true })
      .getByRole("treeitem"),
  ).toHaveCount(3);
  await page
    .locator(`.heading-outline [data-heading-line="${last.line}"]`)
    .click();
  await expect(page.locator(".editor-statusbar")).toContainText(
    `行 ${last.line}，列 1`,
  );
  await page.getByRole("tab", { name: "可视化", exact: true }).click();
  await expect(
    page.getByRole("toolbar", { name: "正文格式", exact: true }),
  ).toBeVisible();
  expect(await page.locator(".document-paper .format-toolbar").count()).toBe(0);
  const toolbar = await page.locator(".format-toolbar").boundingBox();
  await page.locator(".document-canvas").evaluate((node) => {
    node.scrollTop = 700;
  });
  expect((await page.locator(".format-toolbar").boundingBox())!.y).toBe(
    toolbar!.y,
  );
  await page
    .locator(`.heading-outline [data-heading-line="${last.line}"]`)
    .click();
  await expect
    .poll(() =>
      page.locator(".document-canvas").evaluate((node) => node.scrollTop),
    )
    .toBeGreaterThan(1000);
  await page.locator('.heading-outline [data-heading-line="1"]').click();
  await expect
    .poll(() =>
      page.locator(".document-canvas").evaluate((node) => node.scrollTop),
    )
    .toBeLessThan(250);
  const wide = (await page.locator(".document-paper").boundingBox())!.width;
  expect(wide).toBeGreaterThan(600);
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1120, 800),
  );
  await expect
    .poll(
      async () => (await page.locator(".document-paper").boundingBox())!.width,
    )
    .toBeLessThan(wide - 100);
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1440, 940),
  );
  await page.evaluate(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.id = "native-drop-files";
    input.hidden = true;
    document.body.append(input);
  });
  const drop = async (paths: string[], selector: string) => {
    await page!.locator("#native-drop-files").setInputFiles(paths);
    await page!.evaluate((selector) => {
      const input =
          document.querySelector<HTMLInputElement>("#native-drop-files")!,
        target = document.querySelector<HTMLElement>(selector)!;
      const files = new DataTransfer();
      for (const file of input.files!) files.items.add(file);
      const box = target.getBoundingClientRect();
      target.dispatchEvent(
        new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          clientX: Math.max(box.left + 5, box.right - 8),
          clientY: box.top + Math.min(10, box.height / 2),
          dataTransfer: files,
        }),
      );
    }, selector);
  };
  await drop([image], ".document-body p");
  await expect(page.locator('.toast[role="status"]')).toContainText(
    "已插入 1 个资源",
  );
  await expect(
    page.locator(".document-body img:not(.ProseMirror-separator)"),
  ).toHaveAttribute("src", /^data:image\/png/);
  let zip = new AdmZip((await fs.readFile(file)).subarray(2));
  expect(zip.getEntry("resources/image/拖入图片.png")).not.toBeNull();
  expect(zip.readAsText("markdown/001.md")).toContain("resources/image/");
  await drop([pdf], ".document-body p");
  await expect(page.locator('.toast[role="status"]')).toContainText(
    "已插入 1 个资源",
  );
  await expect(page.locator(".document-body")).toContainText("attachment.pdf");
  const before = await fs.readFile(file);
  await drop([image, bad], ".document-body p");
  await expect(page.locator('.toast[role="alert"]')).toContainText(
    "不支持插入此类型",
  );
  expect((await fs.readFile(file)).equals(before)).toBe(true);
  await page.getByRole("button", { name: "关闭提示", exact: true }).click();
  if (!packaged)
    await page.screenshot({
      path: path.join(root, "visual-toolbar-and-outline.png"),
    });
  await page.getByRole("tab", { name: "预览", exact: true }).click();
  await expect(page.locator(".fluid-reading .reading-unit")).toHaveCount(1);
  await expect(page.locator(".reading-unit-label,.preview-toc")).toHaveCount(0);
  await expect(page.locator(".reading-unit h1")).toHaveText("文稿标题");
  expect(
    (await page.locator(".reading-unit").boundingBox())!.width,
  ).toBeGreaterThan(600);
  await page
    .locator(
      `.heading-outline [data-heading-line="${markdownHeadings(mdk.readMdkTextFile(file, "markdown/001.md").content).at(-1)!.line}"]`,
    )
    .click();
  await expect
    .poll(() =>
      page.locator(".reading-preview").evaluate((node) => node.scrollTop),
    )
    .toBeGreaterThan(1000);
  await page.locator('.heading-outline [data-heading-line="1"]').click();
  if (!packaged)
    await page.screenshot({
      path: path.join(root, "default-fluid-preview.png"),
    });
  await page.getByRole("tab", { name: "源码", exact: true }).click();
  await drop([image], ".monaco-source .view-lines");
  await expect(page.locator('.toast[role="status"]')).toContainText(
    "已插入 1 个资源",
  );
  zip = new AdmZip((await fs.readFile(file)).subarray(2));
  expect(zip.getEntry("resources/image/拖入图片-2.png")).not.toBeNull();
  expect(zip.readAsText("markdown/001.md")).toContain(
    "%E6%8B%96%E5%85%A5%E5%9B%BE%E7%89%87-2.png",
  );
  await page.getByRole("textbox", { name: /源码编辑器/ }).focus();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText("\n\n## 新增标题");
  await expect(
    page.getByRole("treeitem", { name: "H2 新增标题", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("treeitem", { name: "H2 新增标题", exact: true })
    .click();
  await page
    .locator('.project-tree-row[data-path="markdown/other.md"]')
    .click();
  await expect(page.locator(".document-title")).toContainText(
    "markdown/other.md",
  );
  await expect(page.locator(".editor-statusbar")).toContainText("行 1，列 1");
  await expect
    .poll(() =>
      page
        .locator(".monaco-source .scrollbar.vertical .slider")
        .first()
        .evaluate((node) => parseFloat((node as HTMLElement).style.top || "0")),
    )
    .toBe(0);
  expect(errors).toEqual([]);
  console.log(
    "Editor desktop passed: removed chrome/tabs, independent fixed toolbar, heading navigation, fluid default layouts, native image/PDF insertion, atomic whitelist rejection and source drop.",
  );
} catch (error) {
  if (page && !packaged)
    await page.screenshot({ path: path.join(root, "failure.png") });
  console.error(await page?.locator(".toast").allTextContents());
  throw error;
} finally {
  await page?.evaluate(() => window.mardikor!.setDirty(false)).catch(() => {});
  await app.close();
}
