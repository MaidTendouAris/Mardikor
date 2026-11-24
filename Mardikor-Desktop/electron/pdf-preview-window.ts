import { app, BrowserWindow, dialog, screen } from "electron";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { t } from "../shared/i18n";
import { serveMedia } from "./media-window";

export const pdfPreviewScheme = "mardikor-pdf-preview";

export async function openPdfPreviewWindow(
  owner: BrowserWindow,
  source: string,
  bytes: Buffer,
  onWindow: (window: BrowserWindow) => void,
) {
  const name = path.basename(source, path.extname(source));
  const url = `${pdfPreviewScheme}://viewer/${encodeURIComponent(name)}.pdf`;
  const { workArea } = screen.getDisplayMatching(owner.getBounds());
  const width = Math.min(workArea.width, 1120);
  const height = Math.min(workArea.height, 860);
  const window = new BrowserWindow({
    parent: owner,
    title: t("{0} · PDF 导出预览", name),
    icon: path.join(app.getAppPath(), "assets/icon.png"),
    width,
    height,
    minWidth: Math.min(width, 480),
    minHeight: Math.min(height, 360),
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
    autoHideMenuBar: true,
    backgroundColor: "#282828",
    show: false,
    webPreferences: {
      partition: `pdf-preview-${randomUUID()}`,
      plugins: true,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  onWindow(window);
  const contents = window.webContents;
  const session = contents.session;
  const entry = { header: { size: bytes.length }, data: bytes };
  const lease = new AbortController();
  session.protocol.handle(pdfPreviewScheme, (request) =>
    request.url === url
      ? serveMedia(request, entry, "application/pdf", lease.signal)
      : new Response(null, { status: 404 }),
  );
  session.webRequest.onBeforeRequest(
    { urls: ["http://*/*", "https://*/*", "file:///*"] },
    (_request, callback) => callback({ cancel: true }),
  );
  session.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  session.setPermissionCheckHandler(() => false);
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-navigate", (event) => event.preventDefault());
  window.on("page-title-updated", (event) => event.preventDefault());
  const preventDownload = (event: Electron.Event) => {
    event.preventDefault();
    if (window.isVisible())
      void dialog
        .showMessageBox(window, {
          message: t("请返回编辑器，使用“导出 PDF”保存文件。"),
        })
        .catch(() => {});
  };
  session.on("will-download", preventDownload);
  window.once("closed", () => {
    lease.abort();
    session.protocol.unhandle(pdfPreviewScheme);
    session.webRequest.onBeforeRequest(null);
    session.setPermissionRequestHandler(null);
    session.setPermissionCheckHandler(null);
    session.removeListener("will-download", preventDownload);
    bytes.fill(0);
  });
  try {
    await contents.loadURL(url);
    if (!process.env.MARDIKOR_HEADLESS) window.show();
  } catch (error) {
    if (window.isDestroyed()) return;
    window.destroy();
    throw error;
  }
}
