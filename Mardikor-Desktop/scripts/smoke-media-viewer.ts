import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { _electron as electron, expect, type Locator } from "@playwright/test";
import { AppState } from "../electron/state";
import {
  createMdkProject,
  importMdkResource,
  saveMdkTextFile,
} from "../electron/mdk";

// A two-second 32×24 VP8 color clip keeps this test independent of FFmpeg.
const webm = Buffer.from(
  "GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAMtEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHGTbuMU6uEElTDZ1OsggEiTbuMU6uEHFO7a1OsggMX7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmoCrXsYMPQkBNgIRMYXZmV0GETGF2ZkSJiECfQAAAAAAAFlSua9euAQAAAAAAAE7XgQFzxYgAAAAAAAAAAZyBACK1nIN1bmSIgQCGhVZfVlA4g4EBI+ODhA7msoDgkLCBILqBGJqBAlWwhFW5gQFV7oEA7AEAAAAAAAACAAASVMNn0HNzzWPAi2PFiAAAAAAAAAABZ8iYRaOHRU5DT0RFUkSHi0xhdmMgbGlidnB4Z8ihRaOIRFVSQVRJT05Eh5MwMDowMDowMi4wMDAwMDAwMDAAH0O2dUGa54EAo76BAACAEAMAnQEqIAAYAABHCIWFiJmEiAICAnWqA/gD+gIIWS6QcP79bvP/5G/j50b/yOP//Eqe44nj//xGgKOwgQD6APEBAAUQrAAYDFFPkNuUcEN7AP7tTd/xpjz8D0A73/9b+S/t/Jf3AfzD1qAAo6+BAfQA0QEABRCsABgAKlf0DAC1zAD+7U3f8aY8/A9AO9//W/kv7fyX9wH8w9agAKOvgQLuANEBAAUQrAAYACpX9AwAtcwA/u1N3/GmPPwPQDvf/1v5L+38l/cB/MPWoACjr4ED6ADRAQAFEKwAGAAqV/QMALXMAP7tTd/xpjz8D0A73/9b+S/t/Jf3AfzD1qAAo6+BBOIA0QEABRCsABgAKlf0DAC1zAD+7U3f8aY8/A9AO9//W/kv7fyX9wH8w9agAKOvgQXcANEBAAUQrAAYACpX9AwAtcwA/u1N3/GmPPwPQDvf/1v5L+38l/cB/MPWoACjroEG1gDRAQAFEBAUYAB5X9AwAQQ4AP79bvP/+Rv4+dG/8jj//4lT3HE8f/+I0AAcU7trkbuPs4EAt4r3gQHxggF38IED",
  "base64",
);

function wav() {
  const bytes = Buffer.alloc(44 + 12 * 8000 * 2);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24);
  bytes.writeUInt32LE(16000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(bytes.length - 44, 40);
  return bytes;
}

const root = path.resolve(".test-artifacts");
await fs.mkdir(root, { recursive: true });
const directory = await fs.mkdtemp(path.join(root, "media-viewer-"));
const profile = path.join(directory, "profile");
const state = new AppState(profile);
state.preferences({
  ...state.preferences(),
  language: "zh-CN",
  autoCheckUpdates: false,
  autosave: false,
});
const project = path.join(directory, "media.mdk");
const standalone = path.join(directory, "standalone.md");
const pngFile = path.join(directory, "测试图片.png");
const audioFile = path.join(directory, "sound.wav");
const videoFile = path.join(directory, "video.webm");
const unsupportedFile = path.join(directory, "unsupported.wmv");
const opaqueFile = path.join(directory, "run 100%#1");
const textFile = path.join(directory, "attachment.html");
const emptyFile = path.join(directory, "empty");
const savedFile = path.join(directory, "saved.png");
const png = await fs.readFile("assets/icon.png");
await Promise.all([
  fs.writeFile(pngFile, png),
  fs.writeFile(audioFile, wav()),
  fs.writeFile(videoFile, webm),
  fs.writeFile(unsupportedFile, "Not a supported video stream"),
  fs.writeFile(
    opaqueFile,
    Buffer.from([0, 0xff, 0x4d, 0x44, 0x4b, 0xd, 0xa, 0x80]),
  ),
  fs.writeFile(
    textFile,
    '<script id="attachment-code">throw new Error("must stay text")</script>',
  ),
  fs.writeFile(emptyFile, ""),
  fs.writeFile(
    standalone,
    "# Standalone\n\n预览正文\n\n[跳到标题](#standalone)\n\n![图片](测试图片.png)\n",
  ),
]);
createMdkProject(project, "00");
const image = importMdkResource(project, pngFile, "image").path;
const audio = importMdkResource(project, audioFile, "audio").path;
const video = importMdkResource(project, videoFile, "video").path;
const unsupported = importMdkResource(project, unsupportedFile, "video").path;
const opaque = importMdkResource(project, opaqueFile, "other").path;
const html = importMdkResource(project, textFile, "other").path;
const empty = importMdkResource(project, emptyFile, "other").path;
saveMdkTextFile(
  project,
  "markdown/001.md",
  [
    "# Media",
    "普通文字",
    `![测试图片](../${image})`,
    `[音频样本](../${audio})`,
    `[视频样本](../${video})`,
    `[不支持的视频](../${unsupported})`,
    `[原始采样记录](../${opaque.split("/").map(encodeURIComponent).join("/")})`,
    `[HTML 附件](../${html})`,
    `[零字节附件](../${empty})`,
  ].join("\n\n"),
);

const executablePath = process.env.MARDIKOR_TEST_EXECUTABLE;
const env = {
  ...process.env,
  MARDIKOR_USER_DATA: profile,
  MARDIKOR_HEADLESS: "offscreen",
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.VITE_DEV_SERVER_URL;
const app = await electron.launch({
  ...(executablePath
    ? { executablePath, args: [project] }
    : { args: [".", project] }),
  env,
});
const editor = await app.firstWindow();
editor.setDefaultTimeout(15000);
const menu = editor.getByRole("menu", { name: /^(正文|预览)右键菜单$/ });
const menuItem = (name: string) =>
  menu.getByRole("menuitem", { name, exact: true });
const pageErrors: string[] = [];
editor.on("pageerror", (error) => pageErrors.push(error.message));

async function openViewer(target: Locator, label: string) {
  await editor.bringToFront();
  await target.scrollIntoViewIfNeeded();
  await editor.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await target.click({ button: "right" });
  await expect(
    menuItem(label),
    `Media context menu for ${(await target.getAttribute("href")) ?? label}`,
  ).toBeVisible();
  const [viewer] = await Promise.all([
    app.waitForEvent("window"),
    menuItem(label).click(),
  ]);
  viewer.setDefaultTimeout(15000);
  viewer.on("pageerror", (error) => pageErrors.push(error.message));
  await expect(viewer.locator(".media-viewer")).toBeVisible();
  return viewer;
}

try {
  await editor.getByRole("tab", { name: "可视化", exact: true }).click();
  const text = editor
    .locator(".document-body p")
    .filter({ hasText: "普通文字" });
  await text.click();
  await editor.keyboard.press("Home");
  await editor.keyboard.press("Shift+End");
  await text.click({ button: "right" });
  await expect(menuItem("复制为 Markdown")).toBeEnabled();
  await expect(menuItem("查看图片")).toHaveCount(0);
  await editor.keyboard.press("Escape");

  const imageTarget = editor.locator(".document-body img[data-mdk-ref]");
  const viewer = await openViewer(imageTarget, "查看图片");
  await expect(viewer.getByRole("img", { name: "测试图片.png" })).toBeVisible();
  await expect(viewer.locator(".media-viewer-filename p")).toContainText(
    /\d+ × \d+/,
  );
  assert.equal(await viewer.evaluate(() => !!window.mardikor), false);
  assert.equal(await editor.evaluate(() => !!window.mardikorMedia), false);
  const stage = viewer.getByRole("region", { name: "图片查看器" });
  const previewImage = viewer.getByRole("img", { name: "测试图片.png" });
  await expect(stage).toHaveCSS("background-color", "rgb(0, 0, 0)");
  await expect(stage).toHaveCSS("background-image", "none");
  await expect(
    viewer.getByRole("button", { name: "适应窗口" }),
  ).toHaveAttribute("aria-pressed", "true");
  const before = (await previewImage.boundingBox())!;
  const stageBounds = (await stage.boundingBox())!;
  // Start from the black padding with the whole picture already fitted.
  await viewer.mouse.move(stageBounds.x + 25, stageBounds.y + 25);
  await viewer.mouse.down({ button: "left" });
  await viewer.mouse.move(stageBounds.x + 155, stageBounds.y + 83, {
    steps: 4,
  });
  await viewer.mouse.up({ button: "left" });
  const after = (await previewImage.boundingBox())!;
  assert.ok(Math.abs(after.x - before.x - 130) < 1);
  assert.ok(Math.abs(after.y - before.y - 58) < 1);
  await stage.click({ button: "right" });
  await viewer
    .getByRole("menu", { name: "图片查看菜单" })
    .getByRole("menuitem", { name: "重置视图" })
    .click();
  await expect(previewImage).toHaveAttribute(
    "style",
    /translate\(0px, 0px\) rotate\(0deg\)/,
  );
  await viewer.getByRole("button", { name: "最大化", exact: true }).click();
  await expect(
    viewer.getByRole("button", { name: "还原", exact: true }),
  ).toBeVisible();
  await viewer.getByRole("button", { name: "还原", exact: true }).click();
  await expect(
    viewer.getByRole("button", { name: "最大化", exact: true }),
  ).toBeVisible();
  const nativeViewer = await app.browserWindow(viewer);
  await viewer.getByRole("button", { name: "最小化", exact: true }).click();
  await expect
    .poll(() => nativeViewer.evaluate((window) => window.isMinimized()))
    .toBe(true);
  await nativeViewer.evaluate((window) => window.restore());
  if (process.env.MARDIKOR_CAPTURE_MEDIA_UI) {
    await viewer.screenshot({ path: path.join(directory, "viewer.png") });
  }
  const fit = await viewer.locator("output").textContent();
  await viewer.getByRole("button", { name: "放大图片" }).click();
  await expect(viewer.locator("output")).not.toHaveText(fit!);
  await viewer.getByRole("button", { name: "实际大小" }).click();
  await expect(viewer.locator("output")).toHaveText("100%");
  await viewer.getByRole("button", { name: "向右旋转" }).click();
  await expect(viewer.locator(".media-viewer-stage img")).toHaveAttribute(
    "style",
    /rotate\(90deg\)/,
  );
  await viewer.getByRole("button", { name: "水平翻转" }).click();
  await expect(
    viewer.getByRole("button", { name: "水平翻转" }),
  ).toHaveAttribute("aria-pressed", "true");
  await viewer.getByRole("button", { name: "复制图片" }).click();
  await expect(
    viewer
      .getByRole("status", { name: "" })
      .filter({ hasText: "图片已复制。" }),
  ).toBeVisible();
  assert.ok(await app.evaluate(({ clipboard }) => clipboard.has("image/png")));
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
  }, savedFile);
  await viewer.getByRole("button", { name: "另存原文件" }).click();
  await expect(
    viewer.getByText("已保存原文件。", { exact: true }),
  ).toBeVisible();
  assert.deepEqual(await fs.readFile(savedFile), png);
  await viewer.getByRole("button", { name: "全屏显示", exact: true }).click();
  await expect(
    viewer.getByRole("button", { name: "退出全屏", exact: true }),
  ).toBeVisible();
  await expect(viewer.locator(".media-viewer-titlebar")).toBeHidden();
  await viewer.getByRole("button", { name: "退出全屏", exact: true }).click();
  await expect(
    viewer.getByRole("button", { name: "全屏显示", exact: true }),
  ).toBeVisible();
  await viewer.getByRole("button", { name: "关闭窗口", exact: true }).click();
  await expect.poll(() => viewer.isClosed()).toBe(true);
  await imageTarget.click({ button: "right" });
  await expect(menuItem("编辑图片")).toBeVisible();
  await expect(menuItem("移除图片")).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: /粘贴/ })).toHaveCount(0);
  await editor.keyboard.press("Escape");

  const audioViewer = await openViewer(
    editor.locator(".document-body a").filter({ hasText: "音频样本" }),
    "播放音频",
  );
  const player = audioViewer.locator("audio");
  await expect
    .poll(() => player.evaluate((el: HTMLAudioElement) => el.duration))
    .toBe(12);
  await audioViewer.getByLabel("播放速度").selectOption("1.5");
  await expect
    .poll(() => player.evaluate((el: HTMLAudioElement) => el.playbackRate))
    .toBe(1.5);
  await audioViewer.getByRole("checkbox", { name: "循环播放" }).check();
  assert.equal(await player.evaluate((el: HTMLAudioElement) => el.loop), true);
  await player.evaluate(async (el: HTMLAudioElement) => {
    el.muted = true;
    el.currentTime = 8;
    await el.play();
  });
  await expect
    .poll(() => player.evaluate((el: HTMLAudioElement) => el.currentTime))
    .toBeGreaterThan(8);

  const videoViewer = await openViewer(
    editor.locator(".document-body a").filter({ hasText: "视频样本" }),
    "查看视频",
  );
  const videoPlayer = videoViewer.locator("video");
  await expect
    .poll(() => videoPlayer.evaluate((el: HTMLVideoElement) => el.videoWidth))
    .toBe(32);
  assert.equal(
    await videoPlayer.evaluate((el: HTMLVideoElement) => el.duration),
    2,
  );
  const unsupportedViewer = await openViewer(
    editor.locator(".document-body a").filter({ hasText: "不支持的视频" }),
    "查看视频",
  );
  await expect(unsupportedViewer.getByRole("alert")).toContainText(
    "不支持此媒体格式或编解码器",
  );
  await unsupportedViewer.close();

  await editor.getByRole("tab", { name: "预览", exact: true }).click();
  for (const [label, input] of [
    ["原始采样记录", opaqueFile],
    ["HTML 附件", textFile],
    ["零字节附件", emptyFile],
  ]) {
    const link = editor
      .locator(".preview-body")
      .getByRole("link", { name: label });
    const [attachment] = await Promise.all([
      app.waitForEvent("window"),
      link.click(),
    ]);
    await expect(attachment.locator(".media-viewer-details")).toContainText(
      path.basename(input),
    );
    if (input === textFile) {
      await expect(attachment.locator("pre")).toContainText("<script");
      await expect(attachment.locator("#attachment-code")).toHaveCount(0);
    }
    const saved = path.join(directory, "extracted-" + path.basename(input));
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    }, saved);
    await attachment
      .getByRole("button", { name: "提取原文件", exact: true })
      .click();
    await expect(
      attachment.getByText("已保存原文件。", { exact: true }),
    ).toBeVisible();
    assert.deepEqual(await fs.readFile(saved), await fs.readFile(input));
    await attachment.close();
  }
  await editor.bringToFront();
  await editor.getByRole("tab", { name: "可视化", exact: true }).click();

  const button = (name: string) =>
    editor.getByRole("button", { name, exact: true });
  await editor.bringToFront();
  await button("访问保护").click();
  await button("设置访问口令").click();
  await editor
    .getByLabel("新访问口令", { exact: true })
    .fill("media viewer test");
  await button("确定").click();
  await editor
    .getByLabel("确认口令", { exact: true })
    .fill("media viewer test");
  await button("确定").click();
  await expect(button("访问保护")).toHaveAttribute("aria-pressed", "true");
  const protectedViewer = await openViewer(imageTarget, "查看图片");
  await expect(
    protectedViewer.getByRole("img", { name: "测试图片.png" }),
  ).toBeVisible();
  await editor.bringToFront();
  await button("访问保护").click();
  await button("锁定工程").click();
  await expect
    .poll(
      () =>
        protectedViewer.isClosed() &&
        audioViewer.isClosed() &&
        videoViewer.isClosed(),
    )
    .toBe(true);

  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
  }, standalone);
  await editor.getByRole("button", { name: "打开工程", exact: true }).click();
  await expect(editor.locator(".document-title")).toContainText(
    "standalone.md",
  );
  await editor.getByRole("tab", { name: "预览", exact: true }).click();
  const preview = editor.locator(".preview-body");
  const previewText = preview.getByText("预览正文", { exact: true });
  const previewMenu = editor.getByRole("menu", { name: "预览右键菜单" });
  await previewText.click({ button: "right" });
  await expect(
    previewMenu.getByRole("menuitem", { name: /^复制\s/ }),
  ).toBeDisabled();
  await previewMenu.getByRole("menuitem", { name: "全选当前预览" }).click();
  assert.match(
    await editor.evaluate(() => window.getSelection()?.toString() ?? ""),
    /预览正文/,
  );
  await previewText.click({ button: "right" });
  await previewMenu.getByRole("menuitem", { name: /^复制\s/ }).click();
  assert.match(
    await app.evaluate(({ clipboard }) => clipboard.readText()),
    /预览正文/,
  );
  await preview
    .getByRole("link", { name: "跳到标题" })
    .click({ button: "right" });
  await expect(
    previewMenu.getByRole("menuitem", { name: "打开链接" }),
  ).toBeVisible();
  await previewMenu.getByRole("menuitem", { name: "复制链接地址" }).click();
  assert.equal(
    await app.evaluate(({ clipboard }) => clipboard.readText()),
    "#standalone",
  );
  await preview.focus();
  await editor.keyboard.press("Shift+F10");
  await expect(previewMenu).toBeVisible();
  await editor.keyboard.press("Escape");
  await expect(preview).toBeFocused();
  const previewViewer = await openViewer(
    editor.locator(".preview-body img[data-mdk-ref]"),
    "查看图片",
  );
  await expect(
    previewViewer.getByRole("img", { name: "测试图片.png" }),
  ).toBeVisible();
  assert.deepEqual(pageErrors, []);
  console.log("Media viewer smoke check passed.");
} finally {
  await app.close();
}
