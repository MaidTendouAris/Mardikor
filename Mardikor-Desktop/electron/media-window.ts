import {
  app,
  BrowserWindow,
  clipboard,
  ClipboardItem,
  dialog,
  screen,
} from "electron";
import path from "node:path";
import fs from "node:fs";
import { rename, rm } from "node:fs/promises";
import { addAbortSignal, Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { crc32 } from "node:zlib";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import type { AppTheme } from "../shared/desktop";
import { appLocale, t } from "../shared/i18n";
import {
  previewMediaKind,
  previewMediaMime,
  type MediaViewerInfo,
  type AttachmentViewerKind,
} from "../shared/media-viewer";
import { BUFFERED_ENTRY_LIMIT, StoreEntry } from "./archive-io";
import { requireDiskSpace } from "./archive-write";
import {
  assertPassiveSvg,
  detectMediaType,
  mediaContainerType,
  publicationRasterSize,
} from "./media";

export const mediaScheme = "mardikor-media";
const src = `${mediaScheme}://viewer/resource`;

export function serveMedia(
  request: Request,
  entry: StoreEntry,
  mime: string,
  lease?: AbortSignal,
) {
  const size = entry.header.size;
  const headers = {
    "Content-Type": mime,
    "Accept-Ranges": "bytes",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "X-Content-Type-Options": "nosniff",
  };
  if (request.method === "HEAD") {
    return new Response(null, {
      headers: { ...headers, "Content-Length": String(size) },
    });
  }
  if (request.method !== "GET") return new Response(null, { status: 405 });
  const range = request.headers.get("range");
  let start = 0;
  let end = size - 1;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match?.[1]) {
      start = Number(match[1]);
      if (match[2]) end = Math.min(end, Number(match[2]));
    } else if (match?.[2]) {
      start = Math.max(0, size - Number(match[2]));
    }
    if (!match || (!match[1] && !match[2]) || start > end) {
      return new Response(null, {
        status: 416,
        headers: { ...headers, "Content-Range": `bytes */${size}` },
      });
    }
  }
  // Bound copies to a chunk while allowing Chromium to seek with range requests.
  let offset = start;
  const bytes = entry.data;
  const signal = lease ? AbortSignal.any([request.signal, lease]) : request.signal;
  const body = Buffer.isBuffer(bytes)
    ? new ReadableStream<Uint8Array>({
        pull(controller) {
          signal.throwIfAborted();
          const next = Math.min(offset + 256 * 1024, end + 1);
          if (next > offset)
            controller.enqueue(new Uint8Array(bytes.subarray(offset, next)));
          offset = next;
          if (offset > end) controller.close();
        },
      })
    : (Readable.toWeb(addAbortSignal(signal, bytes.stream(start, end))) as
        ReadableStream<Uint8Array>);
  return new Response(body, {
    status: range ? 206 : 200,
    headers: {
      ...headers,
      "Content-Length": String(end - start + 1),
      ...(range && {
        "Content-Range": `bytes ${start}-${end}/${size}`,
      }),
    },
  });
}

export function openMediaWindow({
  owner,
  project,
  resource,
  kind,
  entry,
  theme,
  devUrl,
}: {
  owner: BrowserWindow;
  project: string;
  resource: string;
  kind: AttachmentViewerKind;
  entry: StoreEntry;
  theme: AppTheme;
  devUrl?: string;
}) {
  const extensionMime = previewMediaMime(resource);
  const sample = entry.prefix(128 * 1024);
  const detected = detectMediaType(sample);
  const containerMime = mediaContainerType(sample, extensionMime);
  const mediaKind = previewMediaKind(containerMime);
  if (kind === "attachment") kind = mediaKind ?? "attachment";
  let available = !!mediaKind && mediaKind === kind;
  if (kind === "image" && entry.header.size > BUFFERED_ENTRY_LIMIT)
    available = false;
  if (available && containerMime === "image/svg+xml") {
    try {
      assertPassiveSvg(entry.getData());
    } catch {
      available = false;
    }
  }
  const truncated = entry.header.size > sample.length;
  let previewText: string | undefined;
  const pdf = sample.subarray(0, 5).toString("ascii") === "%PDF-";
  if (kind === "attachment" && !detected && !pdf && sample.length) {
    try {
      const decoded = new TextDecoder("utf-8", { fatal: true }).decode(sample, {
        stream: truncated,
      });
      const binary = Array.from(decoded).some((character) => {
        const code = character.charCodeAt(0);
        return (code < 32 && !"\t\r\n".includes(character)) || (code >= 127 && code <= 159);
      });
      if (!binary) previewText = decoded;
    } catch {
      /* Opaque attachment. */
    }
  }
  const info: MediaViewerInfo = {
    kind,
    name: path.posix.basename(resource),
    path: resource,
    bytes: entry.header.size,
    mime:
      containerMime ??
      (pdf
        ? "application/pdf"
        : previewText !== undefined
          ? "text/plain"
          : "application/octet-stream"),
    src: available ? src : null,
    text: previewText,
    truncated,
    locale: appLocale(),
    theme,
  };
  const title =
    kind === "image"
      ? t("图片查看器")
      : kind === "video"
        ? t("视频播放器")
        : kind === "audio"
          ? t("音频播放器")
          : t("附件详情");
  const { workArea } = screen.getDisplayMatching(owner.getBounds());
  const width = Math.min(workArea.width, kind === "audio" ? 720 : 1040);
  const height = Math.min(workArea.height, kind === "audio" ? 400 : 740);
  const window = new BrowserWindow({
    title: `${info.name} — ${title}`,
    icon: path.join(app.getAppPath(), "assets/icon.png"),
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
    width,
    height,
    minWidth: Math.min(width, 480),
    minHeight: Math.min(height, 300),
    frame: false,
    show: false,
    backgroundColor:
      theme === "dark" ? "#141414" : theme === "warm" ? "#eee6d8" : "#f4f6fa",
    webPreferences: {
      preload: path.join(__dirname, "media-preload.cjs"),
      partition: `media-${randomUUID()}`,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: process.env.MARDIKOR_HEADLESS !== "offscreen",
      offscreen: process.env.MARDIKOR_HEADLESS === "offscreen",
    },
  });
  const contents = window.webContents;
  const session = contents.session;
  const file = path.join(__dirname, "../dist/media-viewer.html");
  const url = devUrl
    ? new URL("/media-viewer.html", devUrl).href
    : pathToFileURL(file).href;
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-navigate", (event) => event.preventDefault());
  session.setPermissionRequestHandler((sender, permission, callback) => {
    callback(sender === contents && permission === "fullscreen");
  });
  session.setPermissionCheckHandler(
    (sender, permission) => sender === contents && permission === "fullscreen",
  );
  session.webRequest.onHeadersReceived({ urls: [url] }, (details, callback) => {
    const script = devUrl ? "'self' 'unsafe-inline'" : "'self'";
    const connect = devUrl
      ? `'self' ${new URL(devUrl).origin.replace(/^http/, "ws")}`
      : "'none'";
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          `default-src 'self'; script-src ${script}; style-src 'self' 'unsafe-inline'; img-src ${mediaScheme}:; media-src ${mediaScheme}:; connect-src ${connect}; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'`,
        ],
      },
    });
  });
  if (info.src)
    session.protocol.handle(mediaScheme, (request) =>
      request.url === src
        ? serveMedia(request, entry, info.mime)
        : new Response(null, { status: 404 }),
    );

  function checkSender(event: Electron.IpcMainInvokeEvent) {
    if (
      event.senderFrame !== contents.mainFrame ||
      event.senderFrame?.url !== url
    )
      throw new Error(t("不受信任的 IPC 来源。"));
  }
  contents.ipc.handle("media:info", (event) => {
    checkSender(event);
    return info;
  });
  contents.ipc.handle("media:window", (event, action: unknown) => {
    checkSender(event);
    if (action === "minimize") window.minimize();
    else if (action === "maximize") {
      if (window.isMaximized()) window.unmaximize();
      else window.maximize();
    } else if (action === "close") window.close();
    else throw new Error(t("媒体预览参数无效。"));
  });
  const reportMaximized = () =>
    contents.send("media:maximized", window.isMaximized());
  window.on("maximize", reportMaximized);
  window.on("unmaximize", reportMaximized);
  contents.ipc.handle("media:save", async (event) => {
    checkSender(event);
    const result = await dialog.showSaveDialog(window, {
      title: t("提取原文件"),
      defaultPath: path.join(app.getPath("downloads"), info.name),
    });
    if (result.canceled || !result.filePath || window.isDestroyed())
      return false;
    const normalize = (value: string) =>
      process.platform === "win32"
        ? path.resolve(value).toLowerCase()
        : path.resolve(value);
    if (normalize(result.filePath) === normalize(project))
      throw new Error(t("不能覆盖当前工程文件。"));
    requireDiskSpace(result.filePath, entry.header.size, t("提取原文件"));
    const temporary = path.join(
      path.dirname(result.filePath),
      `.mardikor-${randomUUID()}.tmp`,
    );
    let crc = 0;
    const bytes = entry.data;
    try {
      const input = Buffer.isBuffer(bytes)
        ? Readable.from([bytes])
        : bytes.stream(0, entry.header.size - 1);
      await pipeline(
        input,
        new Transform({
          transform(chunk: Buffer, _encoding, next) {
            crc = crc32(chunk, crc);
            next(null, chunk);
          },
        }),
        fs.createWriteStream(temporary, { flags: "wx", mode: 0o600 }),
      );
      if (entry.crc !== undefined && entry.crc !== crc)
        throw new Error(t("实际大小或 CRC 不一致：{0}", resource));
      if (window.isDestroyed()) return false;
      await rename(temporary, result.filePath);
    } finally {
      await rm(temporary, { force: true });
    }
    return true;
  });
  contents.ipc.handle("media:copy-image", (event, png: Uint8Array) => {
    checkSender(event);
    if (
      info.kind !== "image" ||
      !info.src ||
      !(png instanceof Uint8Array) ||
      png.byteLength > 64 * 1024 * 1024
    )
      throw new Error(t("无法复制图片。"));
    const data = Buffer.from(png);
    if (detectMediaType(data) !== "image/png")
      throw new Error(t("无法复制图片。"));
    publicationRasterSize(data);
    return clipboard.write([
      new ClipboardItem({
        "image/png": new Blob([data], { type: "image/png" }),
      }),
    ]);
  });
  window.once("closed", () => {
    if (info.src) session.protocol.unhandle(mediaScheme);
    session.setPermissionRequestHandler(null);
    session.setPermissionCheckHandler(null);
    session.webRequest.onHeadersReceived(null);
    if (Buffer.isBuffer(entry.data)) entry.data.fill(0);
  });
  window.once("ready-to-show", () => {
    if (!process.env.MARDIKOR_HEADLESS) window.show();
  });
  void (devUrl ? window.loadURL(url) : window.loadFile(file)).catch((error) => {
    if (window.isDestroyed()) return;
    window.destroy();
    if (!owner.isDestroyed())
      void dialog.showMessageBox(owner, {
        type: "error",
        message: t("无法打开媒体查看窗口。"),
        detail: String(error),
      });
  });
  return window;
}
