import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import * as mdk from "../electron/mdk";
import { AppState } from "../electron/state";

const executablePath = process.env.MARDIKOR_TEST_EXECUTABLE;
const root = path.resolve(".test-artifacts/resource-manager");
await fs.mkdir(root, { recursive: true });
const run = await fs.mkdtemp(path.join(root, "run-"));
const profile = path.join(run, "profile");
const file = path.join(run, "resources.mdk");
const files = [path.join(run, "first.txt"), path.join(run, "second.txt")];
const folder = path.join(run, "incoming");
const output = path.join(run, "extracted");
const single = path.join(run, "single.txt");
await fs.mkdir(path.join(folder, "deep"), { recursive: true });
await fs.mkdir(output);
await fs.writeFile(files[0], "first file");
await fs.writeFile(files[1], "second file");
await fs.writeFile(path.join(folder, "deep", "third.txt"), "third file");
mdk.createMdkProject(file, "00");
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
page.setDefaultTimeout(12000);
const errors: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));
const row = (name: string) =>
  page.locator(`.project-tree-row[data-path="${name}"]`);
const search = page.getByRole("textbox", { name: "搜索工程目录" });
async function menu(name: string, action: string) {
  await row(name)
    .getByRole("button", { name: /^操作 / })
    .click();
  await page.getByRole("menuitem", { name: action, exact: true }).click();
}
async function newFolder(parent: string, name: string) {
  await menu(parent, "新建文件夹");
  await page.getByRole("dialog").getByRole("textbox").fill(name);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "创建", exact: true })
    .click();
  await expect(row(parent + "/" + name)).toBeVisible();
}
try {
  await app.evaluate(
    ({ dialog }, chosen) => {
      dialog.showOpenDialog = async (_window, options) => ({
        canceled: false,
        filePaths: options?.properties?.includes("multiSelections")
          ? options.properties.includes("openDirectory")
            ? [chosen.folder]
            : chosen.files
          : [chosen.output],
      });
      dialog.showSaveDialog = async () => ({
        canceled: false,
        filePath: chosen.single,
      });
    },
    { files, folder, output, single },
  );
  await page.getByRole("tab", { name: "整体目录", exact: true }).click();
  await newFolder("resources", "Library");
  await newFolder("resources/Library", "Nested");
  const nested = "resources/Library/Nested";
  await menu(nested, "导入资源文件");
  await expect(row(nested + "/first.txt")).toBeVisible();
  await expect(row(nested + "/second.txt")).toBeVisible();
  await menu(nested, "导入资源文件夹");
  await search.fill("third.txt");
  await expect(row(nested + "/incoming/deep/third.txt")).toBeVisible();
  await search.clear();

  await menu(nested, "重命名");
  await page.getByRole("dialog").getByRole("textbox").fill("Renamed");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "重命名", exact: true })
    .click();
  const renamed = "resources/Library/Renamed";
  await expect(row(renamed)).toBeVisible({ timeout: 12000 });
  await expect(row(nested)).toHaveCount(0);
  await search.fill("first.txt");
  await menu(renamed + "/first.txt", "提取资源文件");
  await expect.poll(() => fs.readFile(single, "utf8")).toBe("first file");

  await page.getByRole("button", { name: "多选", exact: true }).click();
  await search.fill("incoming");
  await row(renamed + "/incoming")
    .getByRole("checkbox")
    .check();
  await search.fill("third.txt");
  await expect(
    row(renamed + "/incoming/deep/third.txt").getByRole("checkbox"),
  ).toBeChecked();
  await row(renamed + "/incoming/deep/third.txt")
    .getByRole("checkbox")
    .uncheck();
  await expect(
    row(renamed + "/incoming").getByRole("checkbox"),
  ).not.toBeChecked();
  await row(renamed + "/incoming")
    .getByRole("checkbox")
    .check();
  await search.fill("second.txt");
  await row(renamed + "/second.txt")
    .getByRole("checkbox")
    .check();
  await search.fill("contents.toml");
  await row("contents.toml").getByRole("checkbox").check();
  await search.fill("001.md");
  await row("markdown/001.md").getByRole("checkbox").check();
  await expect(
    page.getByRole("button", { name: "提取所选项（4）", exact: true }),
  ).toHaveCount(0);
  await row("markdown/001.md").click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "提取所选项（4）", exact: true })
    .click();
  await expect
    .poll(async () => {
      const [directory] = await fs.readdir(output);
      return directory
        ? fs
            .readFile(
              path.join(
                output,
                directory,
                "resources/Library/Renamed/incoming/deep/third.txt",
              ),
              "utf8",
            )
            .catch(() => "")
        : "";
    })
    .toBe("third file");
  const [directory] = await fs.readdir(output);
  expect(
    await fs.readFile(
      path.join(output, directory, "resources/Library/Renamed/second.txt"),
      "utf8",
    ),
  ).toBe("second file");
  expect(
    await fs.readFile(path.join(output, directory, "contents.toml"), "utf8"),
  ).toContain("schema_version");
  expect(
    await fs.readFile(path.join(output, directory, "markdown/001.md"), "utf8"),
  ).toContain("# 001");

  await search.fill("contents.toml");
  await row("contents.toml")
    .getByRole("button", { name: /^操作 / })
    .click();
  await expect(
    page.getByRole("menuitem", { name: "在旁侧打开", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "重命名", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("menuitem", { name: "提取资源文件", exact: true }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
  console.log(
    "Nested resource folders, native multi-import, rename, single and batch extraction, and protected paths passed.",
  );
} catch (error) {
  console.error(
    "Resource operation feedback:",
    await page.locator(".toast").allTextContents(),
  );
  throw error;
} finally {
  await page.evaluate(() => window.mardikor?.setDirty(false)).catch(() => {});
  await app.close();
}
