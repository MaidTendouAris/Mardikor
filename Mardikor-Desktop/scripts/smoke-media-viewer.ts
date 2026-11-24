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
  for (let offset = 44, i = 0; offset < bytes.length; offset += 2, i++)
    bytes.writeInt16LE(Math.round(Math.sin(i * Math.PI / 40) * 1024), offset);
  return bytes;
}

const root = path.resolve(".test-artifacts");
await fs.mkdir(root, { recursive: true });
const directory = await fs.mkdtemp(path.join(root, "media-viewer-"));
const profile = path.join(directory, "profile");
const state = new AppState(profile);
state.windowSize({ width: 1720, height: 980, maximized: false });
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
    "# Standalone\n\n预览正文\n\n[跳到标题](#standalone)\n\n![图片](测试图片.png)\n\n[独立文稿音频](sound.wav)\n",
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
    ? { executablePath, args: ["--mute-audio", project] }
    : { args: [".", "--mute-audio", project] }),
  env,
});
const editor = await app.firstWindow();
editor.setDefaultTimeout(15000);
const menu = editor.getByRole("menu", { name: /^(正文右键菜单|预览右键菜单|媒体播放菜单)$/ });
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
  const viewerClosed = viewer.waitForEvent("close");
  await viewer.getByRole("button", { name: "关闭窗口", exact: true }).click().catch((error) => {
    if (!viewer.isClosed()) throw error;
  });
  await viewerClosed;
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
  assert.equal(await player.evaluate((el: HTMLAudioElement) => el.volume), 0.3);
  await expect(player).not.toHaveAttribute("controls", "");
  const audioBar = audioViewer.getByRole("group", { name: "媒体播放控件" });
  const audioPlay = audioBar.getByRole("button", { name: "播放", exact: true });
  const audioProgress = audioBar.getByRole("slider", { name: "播放进度" });
  const audioVolume = audioBar.getByRole("slider", { name: "音量" });
  const audioLoop = audioBar.getByRole("button", { name: "循环播放" });
  await expect(audioVolume).toBeVisible();
  await expect(audioVolume).toHaveAttribute("aria-valuetext", "30%");
  if (process.env.MARDIKOR_CAPTURE_MEDIA_UI) {
    await audioViewer.screenshot({ path: path.join(directory, "audio-window.png") });
  }
  await audioVolume.press("ArrowRight");
  await expect(audioVolume).toHaveAttribute("aria-valuetext", "31%");
  await expect.poll(() => player.evaluate((el: HTMLAudioElement) => el.volume)).toBe(0.31);
  await audioBar.getByRole("button", { name: "静音", exact: true }).click();
  await expect(audioVolume).toHaveAttribute("aria-valuetext", "0%");
  await audioBar.getByRole("button", { name: "取消静音", exact: true }).click();
  await expect(audioVolume).toHaveAttribute("aria-valuetext", "31%");
  await audioBar.getByRole("combobox", { name: "播放速度" }).click();
  await audioViewer.getByRole("option", { name: "1.5×", exact: true }).click();
  await expect
    .poll(() => player.evaluate((el: HTMLAudioElement) => el.playbackRate))
    .toBe(1.5);
  await audioLoop.click();
  await expect(audioLoop).toHaveAttribute("aria-pressed", "true");
  assert.equal(await player.evaluate((el: HTMLAudioElement) => el.loop), true);
  await audioProgress.press("End");
  await audioProgress.press("ArrowLeft");
  await expect.poll(() => player.evaluate((el: HTMLAudioElement) => el.currentTime)).toBeCloseTo(11.99);
  await audioProgress.press("Home");
  await audioPlay.click();
  const audioPause = audioBar.getByRole("button", { name: "暂停", exact: true });
  await expect(audioPause).toBeVisible();
  await expect
    .poll(() => player.evaluate((el: HTMLAudioElement) => el.currentTime))
    .toBeGreaterThan(0);
  await audioPause.click();
  await expect(audioPlay).toBeVisible();

  const audioScene = audioViewer.locator(".media-player");
  await audioProgress.press("Home");
  await audioScene.press("ArrowRight");
  await expect.poll(() => player.evaluate((el: HTMLAudioElement) => el.currentTime)).toBe(5);
  await audioScene.press("ArrowLeft");
  await expect.poll(() => player.evaluate((el: HTMLAudioElement) => el.currentTime)).toBe(0);
  await audioScene.press("ArrowUp");
  await expect(audioVolume).toHaveAttribute("aria-valuetext", "36%");
  await audioScene.press("ArrowDown");
  await expect(audioVolume).toHaveAttribute("aria-valuetext", "31%");
  await audioScene.focus();
  await audioViewer.keyboard.down("ArrowLeft");
  await expect.poll(() => player.evaluate((el: HTMLAudioElement) => el.playbackRate)).toBe(2);
  await expect(audioScene.getByText("2 倍速播放", { exact: true })).toBeVisible();
  await audioViewer.keyboard.up("ArrowLeft");
  await expect.poll(() => player.evaluate((el: HTMLAudioElement) => [el.playbackRate, el.paused])).toEqual([1.5, true]);
  await audioScene.press("Space");
  await expect(audioPause).toBeVisible();
  await audioViewer.locator(".media-viewer-titlebar").hover();
  await expect(audioScene).toHaveAttribute("data-controls-visible", "false");
  await expect(audioScene.locator(".media-playback-overlay")).toHaveCSS("opacity", "1");
  await expect(audioVolume).toBeVisible();
  await audioScene.press("Space");
  await expect(audioPlay).toBeVisible();
  await audioViewer.evaluate(() => {
    let bass: BiquadFilterNode | undefined;
    let analyser: AnalyserNode | undefined;
    const filter = AudioContext.prototype.createBiquadFilter;
    const pan = AudioContext.prototype.createStereoPanner;
    AudioContext.prototype.createBiquadFilter = function () {
      const node = filter.call(this);
      bass ??= node;
      return node;
    };
    AudioContext.prototype.createStereoPanner = function () {
      const node = pan.call(this);
      const sample = this.createAnalyser();
      const connect = node.connect.bind(node);
      analyser = sample;
      Object.defineProperty(node, "connect", { value(destination: AudioNode) {
        connect(sample);
        return sample.connect(destination);
      } });
      return node;
    };
    Object.assign(window, {
      mediaEffectSample() {
        if (!analyser || !bass) return { bass: 0, peak: 0 };
        const signal = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(signal);
        return { bass: bass.gain.value, peak: Math.max(...signal.map(Math.abs)) };
      },
    });
  });
  const effectSample = () => audioViewer.evaluate(() =>
    (window as typeof window & { mediaEffectSample: () => { bass: number; peak: number } }).mediaEffectSample());
  await audioScene.locator(".media-player-surface").click({ button: "right" });
  await audioViewer.getByRole("menuitem", { name: "音频音效调节", exact: true }).click();
  const audioEffects = audioViewer.getByRole("dialog", { name: "音频音效调节", exact: true });
  await audioEffects.getByRole("slider", { name: "低音", exact: true }).fill("6");
  await expect(audioEffects).toContainText("6 dB");
  await audioEffects.getByRole("button", { name: "关闭对话框", exact: true }).click();
  await audioScene.press("Space");
  await expect.poll(async () => (await effectSample()).bass).toBeGreaterThan(5.8);
  await expect.poll(async () => (await effectSample()).peak).toBeGreaterThan(0.001);
  await audioScene.press("Space");
  await audioScene.press("f");
  await expect(audioBar.getByRole("button", { name: "退出全屏", exact: true })).toBeVisible();
  await audioScene.press("Escape");
  await expect(audioBar.getByRole("button", { name: "全屏", exact: true })).toBeVisible();
  await audioScene.locator(".media-player-surface").click({ button: "right" });
  await audioViewer.getByRole("menuitem", { name: "音频统计信息", exact: true }).click();
  await expect(audioViewer.getByRole("dialog", { name: "音频统计信息", exact: true })).toContainText("31%");

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
  assert.equal(await videoPlayer.evaluate((el: HTMLVideoElement) => el.volume), 0.3);
  await expect(videoPlayer).not.toHaveAttribute("controls", "");
  const videoBar = videoViewer.getByRole("group", { name: "媒体播放控件" });
  const videoScene = videoViewer.locator(".media-player");
  const videoVolume = videoBar.getByRole("slider", { name: "音量" });
  const videoSpeed = videoBar.getByRole("combobox", { name: "播放速度" });
  const videoOverlay = videoScene.locator(".media-playback-overlay");
  const videoSurface = videoScene.locator(".media-player-surface");
  const grayMask = "rgba(40, 41, 44, 0.78)";
  await expect(videoVolume).toBeVisible();
  await expect(videoVolume).toHaveAttribute("aria-valuetext", "30%");
  await videoBar.getByRole("slider", { name: "播放进度", exact: true }).hover();
  const frame = videoScene.locator(".media-timeline-preview canvas");
  await expect(frame).toBeVisible();
  assert.equal(await videoPlayer.evaluate((el: HTMLVideoElement) => el.currentTime), 0);
  assert.ok(await frame.evaluate((canvas: HTMLCanvasElement) => canvas.getContext("2d")!.getImageData(90, 40, 1, 1).data[3]));
  await videoBar.getByRole("button", { name: "循环播放" }).click();
  await videoPlayer.click();
  await expect.poll(() => videoPlayer.evaluate((el: HTMLVideoElement) => el.currentTime)).toBeGreaterThan(0);
  await expect(videoBar.getByRole("button", { name: "暂停", exact: true })).toBeVisible();
  await expect(videoPlayer).toHaveCSS("cursor", "pointer");
  await expect.poll(() => videoSurface.evaluate((el) => getComputedStyle(el, "::after").borderColor)).toBe("rgba(255, 255, 255, 0.36)");
  await expect(videoOverlay).toHaveCSS("opacity", "0");
  await expect(videoPlayer).toHaveCSS("cursor", "none");
  await videoPlayer.hover({ position: { x: 30, y: 30 } });
  await expect(videoOverlay).toHaveCSS("opacity", "1");
  await expect(videoPlayer).toHaveCSS("cursor", "pointer");
  await videoPlayer.dblclick();
  await expect(videoBar.getByRole("button", { name: "退出全屏", exact: true })).toBeVisible();
  await videoScene.press("Escape");
  await expect(videoBar.getByRole("button", { name: "全屏", exact: true })).toBeVisible();
  await videoScene.press("f");
  await expect(videoBar.getByRole("button", { name: "退出全屏", exact: true })).toBeVisible();
  await videoSpeed.click();
  const speedOptions = videoViewer.getByRole("listbox");
  await expect(speedOptions).toHaveCSS("background-color", grayMask);
  assert.equal(await speedOptions.evaluate((el) => !!el.closest(":fullscreen")), true);
  await speedOptions.getByRole("option", { name: "1.25×", exact: true }).click();
  await expect.poll(() => videoPlayer.evaluate((el: HTMLVideoElement) => el.playbackRate)).toBe(1.25);
  await videoPlayer.click({ button: "right" });
  const videoMenu = videoViewer.getByRole("menu", { name: "媒体播放菜单", exact: true });
  await expect(videoMenu).toHaveCSS("background-color", grayMask);
  if (process.env.MARDIKOR_CAPTURE_MEDIA_UI) {
    await videoViewer.screenshot({ path: path.join(directory, "video-menu.png") });
  }
  await videoMenu.getByRole("menuitem", { name: "视频色彩调整", exact: true }).click();
  const colors = videoViewer.getByRole("dialog", { name: "视频色彩调整", exact: true });
  await expect(colors).toHaveCSS("background-color", grayMask);
  await colors.getByRole("slider", { name: "亮度", exact: true }).fill("120");
  await expect(videoPlayer).toHaveCSS("filter", /brightness\(1.2\)/);
  await videoScene.press("Escape");
  await expect(colors).toBeHidden();
  await videoPlayer.click({ button: "right" });
  await videoViewer.getByRole("menuitem", { name: "视频统计信息", exact: true }).click();
  await expect(videoViewer.getByRole("dialog", { name: "视频统计信息", exact: true })).toContainText("32 × 24");
  const unsupportedViewer = await openViewer(
    editor.locator(".document-body a").filter({ hasText: "不支持的视频" }),
    "查看视频",
  );
  await expect(unsupportedViewer.getByRole("alert")).toContainText(
    "不支持此媒体格式或编解码器",
  );
  await unsupportedViewer.close();

  await editor.getByRole("tab", { name: "预览", exact: true }).click();
  const inline = (name: string) => editor.locator(".preview-body").getByRole("group", { name, exact: true });
  const controls = (name: string, action: string) =>
    inline(name).getByRole("button", { name: action, exact: true });
  const inlineAudio = inline("音频样本").locator("audio");
  await expect(inlineAudio).toHaveCount(1);
  await expect(inlineAudio).not.toHaveAttribute("src", /.+/);
  assert.equal(await inlineAudio.evaluate((el: HTMLAudioElement) => el.volume), 0.3);
  const audioGroup = inline("音频样本");
  const volumeSlider = audioGroup.getByRole("slider", { name: "音量" });
  const volumeValue = audioGroup.locator(".preview-player-volume-value");
  await expect(audioGroup.locator(".media-player-surface")).toBeHidden();
  await expect(volumeSlider).toBeVisible();
  await expect(volumeSlider).toHaveAttribute("aria-valuenow", "30");
  await expect(volumeValue).toHaveText("30%");
  assert.ok(await audioGroup.evaluate((el) => el.getBoundingClientRect().height < 96));
  if (process.env.MARDIKOR_CAPTURE_MEDIA_UI) {
    await audioGroup.screenshot({ path: path.join(directory, "audio-inline.png") });
    console.log(`Captured media UI in ${directory}`);
  }
  const wideWidth = await audioGroup.evaluate((el) => ({
    player: el.getBoundingClientRect().width,
    slot: el.parentElement!.getBoundingClientRect().width,
  }));
  assert.equal(wideWidth.player, wideWidth.slot);
  await audioGroup.evaluate((el) => {
    el.parentElement!.style.width = "320px";
    el.parentElement!.style.zoom = "1.25";
    window.getSelection()?.removeAllRanges();
  });
  await volumeSlider.scrollIntoViewIfNeeded();
  assert.equal(await audioGroup.evaluate((el) => el.getBoundingClientRect().width), 400);
  const volumeTrack = volumeSlider.locator(".player-slider-track");
  const trackBounds = await volumeTrack.boundingBox();
  assert.ok(trackBounds && trackBounds.width > 88);
  await editor.mouse.move(trackBounds.x + trackBounds.width * 0.3, trackBounds.y + 2);
  await editor.mouse.down();
  await editor.mouse.move(
    trackBounds.x + trackBounds.width * 0.73,
    trackBounds.y - 22,
    { steps: 6 },
  );
  await expect(volumeSlider).toHaveAttribute("data-dragging", "true");
  await expect(volumeValue).toHaveText("73%");
  assert.equal(await inlineAudio.evaluate((el: HTMLAudioElement) => el.volume), 0.73);
  assert.deepEqual(await volumeSlider.evaluate((el) => [
    getComputedStyle(el).outlineStyle,
    getComputedStyle(el.firstElementChild!, "::after").outlineStyle,
    window.getSelection()?.isCollapsed,
  ]), ["none", "none", true]);
  await editor.mouse.up();
  await expect(volumeSlider).not.toHaveAttribute("data-dragging", "true");
  await volumeSlider.press("ArrowLeft");
  await expect(volumeValue).toHaveText("72%");
  await audioGroup.evaluate((el) => {
    el.parentElement!.style.removeProperty("width");
    el.parentElement!.style.removeProperty("zoom");
  });
  await controls("音频样本", "静音").click();
  await expect(volumeValue).toHaveText("0%");
  await controls("音频样本", "播放").click();
  await expect.poll(() => inlineAudio.evaluate((el: HTMLAudioElement) => el.duration)).toBe(12);
  await expect.poll(() => inlineAudio.evaluate((el: HTMLAudioElement) => el.currentTime)).toBeGreaterThan(0);
  await controls("音频样本", "暂停").click();
  await inline("音频样本").getByRole("slider", { name: "播放进度" }).focus();
  await editor.keyboard.press("End");
  await expect.poll(() => inlineAudio.evaluate((el: HTMLAudioElement) => el.currentTime)).toBe(12);
  const inlineVideo = inline("视频样本").locator("video");
  assert.equal(await inlineVideo.evaluate((el: HTMLVideoElement) => el.volume), 0.3);
  const inlineVideoLink = editor.locator(".preview-body").getByRole("link", { name: "视频样本" });
  await inlineVideoLink.focus();
  await inlineVideo.hover();
  await expect(inline("视频样本")).toBeFocused();
  await inlineVideoLink.hover();
  await expect(inlineVideoLink).toBeFocused();
  await inlineVideoLink.click();
  await expect.poll(() => inlineVideo.evaluate((el: HTMLVideoElement) => el.videoWidth)).toBe(32);
  assert.equal(await inlineVideo.evaluate((el: HTMLVideoElement) => el.duration), 2);
  const videoRatio = await inlineVideo.evaluate((el) => {
    const bounds = el.getBoundingClientRect();
    return bounds.width / bounds.height;
  });
  assert.ok(Math.abs(videoRatio - 4 / 3) < 0.01);
  await controls("视频样本", "全屏").click();
  await expect(controls("视频样本", "退出全屏")).toBeVisible();
  await controls("视频样本", "退出全屏").click();
  await expect(controls("视频样本", "全屏")).toBeVisible();
  await controls("不支持的视频", "播放").click();
  await expect(inline("不支持的视频").getByRole("status")).toContainText("不支持的格式或编解码器");
  const lightPlayerBackground = await inline("音频样本").evaluate((el) => getComputedStyle(el).backgroundColor);
  await editor.evaluate(() => { document.documentElement.dataset.appTheme = "dark"; });
  await expect.poll(() => inline("音频样本").evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(lightPlayerBackground);
  await editor.evaluate(() => { document.documentElement.dataset.appTheme = "light"; });
  await videoViewer.close();
  const inlinePopup = await openViewer(inline("视频样本").locator("video"), "打开新窗口播放");
  await expect.poll(() => inlinePopup.locator("video").evaluate((el: HTMLVideoElement) => el.videoWidth)).toBe(32);
  await inlinePopup.close();
  console.log("Inline players decode WAV and WebM, seek, follow the theme and open a separate playback window.");

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
  await editor.getByRole("tab", { name: "整体目录", exact: true }).click();
  const treeSearch = editor.getByRole("textbox", { name: "搜索工程目录" });
  await treeSearch.fill(path.basename(audio));
  await editor.locator(`.project-tree-row[data-path="${audio}"]`).click();
  const assetPlayer = editor.locator(".resource-preview .preview-player");
  await assetPlayer.getByRole("button", { name: "静音", exact: true }).click();
  await assetPlayer.getByRole("button", { name: "播放", exact: true }).click();
  await expect.poll(() => assetPlayer.locator("audio").evaluate((el: HTMLAudioElement) => el.duration)).toBe(12);
  await treeSearch.clear();
  await editor.getByRole("tab", { name: "文稿目录", exact: true }).click();
  await editor.locator('.project-tree-row[data-path="markdown/001.md"]').click();
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
  await editor.getByRole("tab", { name: "预览", exact: true }).click();
  await controls("音频样本", "静音").click();
  await controls("音频样本", "播放").click();
  await expect.poll(() => inlineAudio.evaluate((el: HTMLAudioElement) => el.currentTime)).toBeGreaterThan(0);
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
  await controls("独立文稿音频", "静音").click();
  await controls("独立文稿音频", "播放").click();
  await expect.poll(() => inline("独立文稿音频").locator("audio")
    .evaluate((el: HTMLAudioElement) => el.currentTime)).toBeGreaterThan(0);
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
