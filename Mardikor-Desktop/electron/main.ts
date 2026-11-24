import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  protocol,
  screen,
  shell,
} from "electron";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import * as mdk from "./mdk";
import { initEnvelopeCrypto, passwordBytes, probeEnvelope, readBoundedFile } from "./envelope";
import { withAccess, type AccessSession } from "./access-session";
import { mediaScheme, openMediaWindow, serveMedia } from "./media-window";
import { addedFile, BUFFERED_ENTRY_LIMIT, FileSnapshot, type StoreEntry } from "./archive-io";
import { mediaContainerType } from "./media";
import { previewMediaKind, previewMediaMime, type PlaybackKind } from "../shared/media-viewer";
import { seedArchiveIndex } from "./archive";
import type { ArchiveTask } from "./archive-worker";
import type { ArchiveProgress } from "../shared/archive-operation";
import {
  publishEnvelopeOutput,
  type EnvelopeResult,
  type EnvelopeTask,
} from "./envelope-operations";
import { isMdkeCompression, type AccessChangeResult, type EnvelopeAction } from "../shared/envelopes";
import type { SaveSnapshot } from "../shared/mdk";
import type { InsertionSource } from "./insertion-assets";
import { AppState } from "./state";
import { t, appLocale, resolveAppLocale, setAppLocale } from "../shared/i18n";
import { containsControl, validatePath } from "../shared/schema";
import { isDocumentPosition, type DocumentPosition } from "../shared/document-position";
import { insertionFormats } from "../shared/resources";
import { isMarkdownFile, isSupportedDocument } from "../shared/workspace";
import * as markdownFile from "./markdown-file";
import { watchProjectFile } from "./project-watch";
import * as publication from "./publication";
import { publicationRuntime } from "./publication-runtime";
import { openPdfPreviewWindow, pdfPreviewScheme } from "./pdf-preview-window";
import { fallbackFontFile, fallbackFontUrl, systemFontName } from "../shared/fonts";
import { listSystemFonts, readSystemFont } from "./system-fonts";
import { fontMediaType, parsedFont } from "./document-font";
import { resourceName } from "./resource-files";
import { autoUpdater } from "electron-updater";
import { UpdateService } from "./update-service";
import type { UpdateAction } from "../shared/updates";
import type { MdkCommands, DialogKind, Preferences } from "../shared/desktop";

interface DocumentWindow {
  window: BrowserWindow;
  readyToShow?: boolean;
  recoveryOwner: string;
  dirty: boolean;
  activeProject: string;
  documentPosition?: DocumentPosition;
  queuedFile?: string;
  queuedFragment?: string;
  approvedFiles: Set<string>;
  revisions: Map<string, string>;
  stopWatching?: () => void;
  droppedFiles: Map<string, { sources: InsertionSource[]; expires: number }>;
  publicationOutputs: Map<string, { revision: string | null; expires: number }>;
  pdfPreview?: BrowserWindow;
  pdfPreviewJob?: symbol;
  access?: AccessSession;
  pendingAccess?: AccessSession;
  mediaWindows: Map<string, BrowserWindow>;
  playback: Map<string, { resource: string; kind: PlaybackKind; abort: AbortController }>;
  bufferedPlayback?: { url: string; revision: string; entry: StoreEntry };
  archiveJob?: Int32Array;
  closeAfterArchive?: boolean;
}
const windows = new Map<number, DocumentWindow>();
const pendingFiles: string[] = [];
let acceptingFiles = false;
let state: AppState;
let updates: UpdateService;
let pendingWindowSize: Parameters<AppState["windowSize"]>[0];
let windowSizeTimer: ReturnType<typeof setTimeout> | undefined;
let envelopeWork: { owner: DocumentWindow; cancel: () => void } | undefined;

function windowAccess(context: DocumentWindow, file: string) {
  return context.access?.file === path.resolve(file) ? context.access : undefined;
}

function recover(context: DocumentWindow, file: string, value?: SaveSnapshot | null) {
  const access = windowAccess(context, file);
  if (!access && value !== null && fs.existsSync(file) && /\.mdk$/i.test(file) &&
    probeEnvelope(file) === "MDKP")
    throw new Error(t("此 MDK 需要访问口令。"));
  return state.recovery(file, value, context.recoveryOwner, access);
}

function envelopeWorker(owner: DocumentWindow, task: EnvelopeTask) {
  if (envelopeWork) throw new Error(t("已有封装任务正在运行。"));
  return new Promise<EnvelopeResult>((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, "envelope-worker.cjs"), {
      workerData: { task, locale: appLocale() },
    });
    const timer = setTimeout(() => stop(t("封装任务超过 120 秒的处理限额。")), 120_000);
    const finish = () => {
      clearTimeout(timer);
      if (envelopeWork?.cancel === cancel) envelopeWork = undefined;
    };
    function stop(message: string) {
      finish();
      reject(new Error(message));
      void worker.terminate();
    }
    envelopeWork = { owner, cancel: () => stop(t("封装任务已取消。")) };
    worker.once("message", ({ result, error }) => {
      finish();
      if (error) reject(new Error(error));
      else resolve(result);
    });
    worker.once("error", (error) => { finish(); reject(error); });
    worker.once("exit", (code) => {
      if (envelopeWork?.owner === owner && envelopeWork?.cancel === cancel) {
        stop(t("封装任务意外结束（{0}）。", code));
      }
    });
    const cancel = envelopeWork.cancel;
  });
}
function persistWindowSize() {
  clearTimeout(windowSizeTimer);
  if (!pendingWindowSize) return;
  try {
    state.windowSize(pendingWindowSize);
  } catch (error) {
    console.error(t("无法保存窗口尺寸"), error);
  }
  pendingWindowSize = undefined;
}
const updateSaves = new Map<
  string,
  { sender: number; finish: (saved: boolean) => void }
>();
function saveForUpdate(context: DocumentWindow) {
  return new Promise<boolean>((resolve) => {
    const request = randomUUID();
    const timer = setTimeout(() => finish(false), 60000);
    const finish = (saved: boolean) => {
      clearTimeout(timer);
      updateSaves.delete(request);
      resolve(saved);
    };
    updateSaves.set(request, { sender: context.window.webContents.id, finish });
    context.window.webContents.send("app:save-for-update", request);
  });
}
type DiscardedUpdate = {
  context: DocumentWindow;
  draft: ReturnType<AppState["recovery"]>;
};
async function prepareUpdate(discarded: DiscardedUpdate[]) {
  for (const context of windows.values()) {
    if (context.window.isDestroyed() || !context.dirty) continue;
    const { response } = await dialog.showMessageBox(context.window, {
      type: "question",
      title: t("安装更新前处理未保存内容"),
      message: t(
        "{0} 有未保存的更改。",
        path.basename(context.activeProject) || t("当前窗口"),
      ),
      detail: t("安装更新将关闭所有 Mardikor 窗口。"),
      buttons: [t("保存并更新"), t("放弃更改并更新"), t("取消更新")],
      defaultId: 0,
      cancelId: 2,
    });
    if (response === 2) return false;
    if (response === 0 && !(await saveForUpdate(context))) return false;
    if (response === 1)
      discarded.push({
        context,
        draft: context.activeProject
          ? recover(context, context.activeProject)
          : null,
      });
    else context.dirty = false;
  }
  const approvedDiscards = new Set(discarded.map((item) => item.context));
  if (
    [...windows.values()].some(
      (context) => context.dirty && !approvedDiscards.has(context),
    )
  )
    return false;
  // Discard only after every window has agreed. Cancelling a later window must
  // preserve earlier windows' dirty flags and recovery drafts.
  for (const { context } of discarded) {
    if (context.activeProject)
      recover(context, context.activeProject, null);
    context.dirty = false;
  }
  return true;
}
function largeArchive(file: string) {
  return (fs.statSync(file, { throwIfNoEntry: false })?.size ?? 0) > BUFFERED_ENTRY_LIMIT;
}
const archiveTasks = new Set<string>(["open", "validate", "saveSnapshot", "copyDraft", "importResource", "export", "exportPlan", "pack", "unpack", "saveMdkPublication"] satisfies ArchiveTask[]);

async function runArchiveTask<T>(context: DocumentWindow, task: ArchiveTask, args: unknown[], expected?: string): Promise<T> {
  if (context.archiveJob) throw new Error(t("此窗口已有 MDK 文件操作正在运行。"));
  const progress = new SharedArrayBuffer(4);
  const state = new Int32Array(progress);
  const worker = new Worker(path.join(__dirname, "archive-worker.cjs"), {
    workerData: { task, args, progress, locale: appLocale(), expected },
  });
  context.archiveJob = state;
  const started = Date.now();
  const notify = (value: ArchiveProgress | null) => {
    if (!context.window.isDestroyed()) context.window.webContents.send("app:archive-progress", value);
  };
  try {
    return await new Promise<T>((resolve, reject) => {
      worker.on("message", (message: { progress?: ArchiveProgress; result: T; error?: string; index?: Parameters<typeof seedArchiveIndex>[1] }) => {
        if (message.progress) {
          if (Date.now() - started >= 300) notify(message.progress);
        } else if (message.error !== undefined) reject(new Error(message.error));
        else {
          if (message.index) {
            try { seedArchiveIndex(new FileSnapshot(path.resolve(args[0] as string)), message.index); }
            catch { /* A later operation will recheck a changed or missing source. */ }
          }
          resolve(message.result);
        }
      });
      worker.once("error", reject);
      worker.once("exit", () => reject(new Error(t("MDK 文件操作意外结束。"))));
    });
  } finally {
    context.archiveJob = undefined;
    notify(null);
    if (context.closeAfterArchive && !context.window.isDestroyed()) {
      context.closeAfterArchive = undefined;
      setImmediate(() => { if (!context.window.isDestroyed()) context.window.close(); });
    }
  }
}

function createHandlers(context: DocumentWindow): MdkCommands {
  const { droppedFiles, publicationOutputs } = context;
  async function extractFiles(
    file: string,
    paths: string[],
    revision: string,
    resourcesOnly: boolean,
  ) {
    const threaded = !windowAccess(context, file) && largeArchive(file);
    const args = [file, paths, revision, resourcesOnly];
    const plan = threaded ? undefined : mdk.prepareMdkResourceExtraction(file, paths, revision, resourcesOnly);
    const filename = threaded ? await runArchiveTask<string | undefined>(context, "extractPlan", args) : plan?.filename;
    const extract = (output: string) => threaded
      ? runArchiveTask<ReturnType<NonNullable<typeof plan>["extract"]>>(context, "extractFiles", [...args, output])
      : plan!.extract(output);
    if (filename) {
      const result = await dialog.showSaveDialog(context.window, {
        title: resourcesOnly ? t("提取资源文件") : t("提取文件"),
        defaultPath: filename,
      });
      return result.canceled || !result.filePath
        ? null
        : extract(result.filePath);
    }
    const result = await dialog.showOpenDialog(context.window, {
      title: resourcesOnly
        ? t("选择资源导出的目标目录")
        : t("选择文件提取的目标目录"),
      properties: ["openDirectory", "createDirectory"],
    });
    return result.canceled || !result.filePaths[0]
      ? null
      : extract(result.filePaths[0]);
  }
  const exportRuntime = (source?: string) =>
    publicationRuntime(
      state,
      (file) => {
        const key = path.resolve(file),
          approval = publicationOutputs.get(key);
        publicationOutputs.delete(key);
        if (!approval || approval.expires < Date.now())
          throw new Error(t("请选择 PDF / EPUB 输出文件并确认覆盖。"));
        return approval.revision;
      },
      source
        ? (stage) => {
            if (!context.window.isDestroyed())
              context.window.webContents.send(
                "app:publication-progress",
                source,
                stage,
              );
          }
        : undefined,
      (name) => readSystemFont(context.window.webContents, name),
    );
  const handlers: MdkCommands = {
    packFont: async (file, revision) => {
      const source = path.resolve(file);
      if (context.activeProject !== source || !/^[0-9a-f]{64}$/.test(revision))
        throw new mdk.MdkRevisionError();
      const fontsFolder = process.platform === "win32" && process.env.SystemRoot
        ? path.join(process.env.SystemRoot, "Fonts")
        : undefined;
      const selected = await dialog.showOpenDialog(context.window, {
        title: t("打包允许分发的字体文件"),
        defaultPath: fontsFolder,
        filters: [{ name: t("字体文件"), extensions: ["otf", "ttf"] }],
        properties: ["openFile"],
      });
      const filename = selected.filePaths[0];
      if (selected.canceled || !filename || context.window.isDestroyed()) return null;
      if (context.activeProject !== source) throw new mdk.MdkRevisionError();
      const name = path.basename(filename).normalize("NFC");
      resourceName(name);
      const bytes = readBoundedFile(filename, BUFFERED_ENTRY_LIMIT);
      fontMediaType(name, bytes);
      parsedFont(bytes);
      if (isMarkdownFile(file))
        return markdownFile.packMarkdownFont(file, name, bytes, revision);
      const license = publication.knownNotoLicense(bytes, path.join(app.getAppPath(), "assets/export"));
      return windowAccess(context, file)
        ? mdk.packMdkFont(file, name, bytes, revision, license)
        : runArchiveTask<ReturnType<typeof mdk.packMdkFont>>(
          context, "packFont", [file, name, bytes, revision, license]);
    },
    readFont: mdk.readMdkFont,
    publicationInfo: (file) =>
      publication.publicationInfo(file, exportRuntime()),
    configurePublication: async (file, configuration, revision, format) => {
      const name = systemFontName(configuration?.appearance?.font_family);
      const font = name ? { name, bytes: await readSystemFont(context.window.webContents, name) } : undefined;
      return publication.configurePublication(
        file,
        configuration,
        revision,
        exportRuntime(),
        format,
        font,
      );
    },
    planPublication: (file, format, presetId) =>
      publication.planPublication(file, format, exportRuntime(file), presetId),
    previewPdf: async (file, fingerprint, presetId) => {
      if (context.activeProject !== path.resolve(file) || context.pdfPreviewJob)
        throw new Error(t("当前无法打开 PDF 导出预览。"));
      const job = Symbol();
      context.pdfPreviewJob = job;
      try {
        const bytes = await publication.previewPdf(
          file,
          fingerprint,
          exportRuntime(file),
          presetId,
        );
        if (context.pdfPreviewJob !== job || context.window.isDestroyed()) {
          bytes.fill(0);
          return;
        }
        context.pdfPreview?.destroy();
        await openPdfPreviewWindow(context.window, file, bytes, (preview) => {
          context.pdfPreview = preview;
          preview.once("closed", () => {
            if (context.pdfPreview === preview) context.pdfPreview = undefined;
          });
        });
      } finally {
        if (context.pdfPreviewJob === job) context.pdfPreviewJob = undefined;
      }
    },
    exportPublication: (file, output, format, fingerprint, presetId) =>
      publication.exportPublication(
        file,
        output,
        format,
        fingerprint,
        exportRuntime(file),
        presetId,
      ),
    create: mdk.createMdkProject,
    saveMdkPublication: mdk.saveMdkPublication,
    open: mdk.openMdkProject,
    readEntry: mdk.readMdkEntry,
    saveEntry: mdk.saveMdkEntry,
    addEntry: mdk.addMdkEntry,
    addGroup: mdk.addMdkGroup,
    indexFile: mdk.addMdkReference,
    deleteEntry: mdk.deleteMdkEntry,
    renameEntry: mdk.renameMdkEntry,
    reorderEntries: mdk.reorderMdkEntries,
    splitEntry: mdk.splitMdkEntry,
    importResource: mdk.importMdkResource,
    createResourceFolder: mdk.createMdkResourceFolder,
    renameResource: mdk.renameMdkResource,
    deleteResource: mdk.deleteMdkResource,
    importResourcesTo: async (file, folder, mode, revision) => {
      if (mode !== "files" && mode !== "folders")
        throw new Error(t("文件对话框参数无效。"));
      const result = await dialog.showOpenDialog(context.window, {
        title: mode === "files" ? t("导入资源文件") : t("导入资源文件夹"),
        properties: [
          mode === "files" ? "openFile" : "openDirectory",
          "multiSelections",
        ],
      });
      if (result.canceled || !result.filePaths.length) return null;
      if (!windowAccess(context, file))
        return runArchiveTask<ReturnType<typeof mdk.importMdkResourceBatch>>(context, "importResourcesTo", [file, folder, result.filePaths, revision]);
      return mdk.importMdkResourceBatch(
        file,
        folder,
        result.filePaths,
        revision,
      );
    },
    extractResources: (file, paths, revision) =>
      extractFiles(file, paths, revision, true),
    extractProjectFiles: (file, paths, revision) =>
      extractFiles(file, paths, revision, false),
    insertResources: (file, token, insertion) => {
      const files = droppedFiles.get(token);
      droppedFiles.delete(token);
      if (!files || files.expires < Date.now())
        throw new Error(t("拖入文件授权已失效，请重新拖入。"));
      if (isMarkdownFile(file)) return markdownFile.insertMarkdownResources(file, files.sources, insertion);
      if (!windowAccess(context, file) && (largeArchive(file) || files.sources.some((source) => typeof source === "string" && largeArchive(source))))
        return runArchiveTask<ReturnType<typeof mdk.insertMdkResources>>(context, "insertResources", [file, files.sources, insertion]);
      return mdk.insertMdkResources(file, files.sources, insertion);
    },
    readText: mdk.readMdkTextFile,
    readDocuments: mdk.readMdkDocuments,
    saveText: mdk.saveMdkTextFile,
    addPublicationPreset: mdk.addPublicationPreset,
    updateSettings: mdk.updateMdkSettings,
    export: mdk.exportMdk,
    exportPlan: mdk.planMdkExport,
    saveSnapshot: mdk.saveMdkSnapshot,
    copyDraft: mdk.copyMdkDraft,
    readingUnits: mdk.readMdkReadingUnits,
    validate: mdk.validateMdk,
    readMode: mdk.readMdkMode,
    readResource: mdk.readMdkResource,
    setMode: mdk.setMdkMode,
    checkPackDirectory: mdk.checkMdkDirectory,
    pack: mdk.packMdk,
    unpack: mdk.unpackMdk,
  };
  return handlers;
}
const devUrl = !app.isPackaged ? process.env.VITE_DEV_SERVER_URL : undefined;
const rendererFile = path.join(__dirname, "../dist/index.html");
protocol.registerSchemesAsPrivileged([
  {
    scheme: "mardikor-export",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
  {
    scheme: mediaScheme,
    privileges: { standard: true, secure: true, stream: true, corsEnabled: true, supportFetchAPI: true },
  },
  {
    scheme: pdfPreviewScheme,
    privileges: { standard: true, secure: true, stream: true, corsEnabled: true, supportFetchAPI: true },
  },
]);
if (process.env.MARDIKOR_USER_DATA)
  app.setPath("userData", process.env.MARDIKOR_USER_DATA);

function verifySender(
  event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent,
) {
  const frame = event.senderFrame;
  const context = windows.get(event.sender.id);
  if (
    !context ||
    event.sender !== context.window.webContents ||
    frame !== event.sender.mainFrame
  )
    throw new Error(t("不受信任的 IPC 来源。"));
  const url = frame?.url ?? "";
  if (!isRendererUrl(url))
    throw new Error(t("IPC 页面来源无效。"));
  return context;
}
function isRendererUrl(url: string) {
  return !!url && (devUrl
    ? new URL(url).origin === new URL(devUrl).origin
    : url.split(/[?#]/)[0] === pathToFileURL(rendererFile).href);
}
function assertApproved(
  context: DocumentWindow,
  file: unknown,
): asserts file is string {
  if (
    typeof file !== "string" ||
    !context.approvedFiles.has(path.resolve(file))
  )
    throw new Error(t("请通过文件对话框选择此路径。"));
}
function watchActiveProject(context: DocumentWindow, source: string) {
  if (context.activeProject !== source) {
    persistDocumentPosition(context);
    closeProjectViewers(context);
    context.stopWatching?.();
    context.activeProject = source;
    let reportedRevision: string | null | undefined;
    context.stopWatching = watchProjectFile(source, (revision) => {
      if (context.window.isDestroyed() || context.activeProject !== source)
        return;
      const changed = context.revisions.get(source) !== revision;
      if (reportedRevision === (changed ? revision : undefined)) return;
      reportedRevision = changed ? revision : undefined;
      context.window.webContents.send("app:project-changed", source, revision);
    });
  }
  context.window.setTitle(`${path.basename(source)} - Mardikor`);
}
function persistDocumentPosition(context: DocumentWindow) {
  const { activeProject, documentPosition } = context;
  context.documentPosition = undefined;
  if (activeProject && documentPosition) {
    try {
      state.documentPosition(activeProject, documentPosition);
    } catch (error) {
      console.error(error);
    }
  }
}
function closeProjectViewers(context: DocumentWindow) {
  context.pdfPreviewJob = undefined;
  context.pdfPreview?.destroy();
  for (const window of context.mediaWindows.values()) window.destroy();
  for (const grant of context.playback.values()) grant.abort.abort();
  context.playback.clear();
  context.bufferedPlayback = undefined;
}

function servePreviewPlayback(context: DocumentWindow, request: Request) {
  if (request.url === fallbackFontUrl) {
    const data = fs.readFileSync(path.join(app.getAppPath(), "assets/export", fallbackFontFile));
    return serveMedia(request, { header: { size: data.length }, data }, "font/otf");
  }
  const grant = context.playback.get(request.url);
  const project = context.activeProject;
  if (!grant || !project) return new Response(null, { status: 404 });
  if (request.method !== "GET" && request.method !== "HEAD")
    return new Response(null, { status: 405 });
  try {
    let entry: StoreEntry;
    if (isMarkdownFile(project)) {
      entry = addedFile(grant.resource, markdownFile.resolveLocalMarkdownPath(project, grant.resource));
    } else {
      const revision = new FileSnapshot(project).key;
      const cached = context.bufferedPlayback;
      if (cached?.url === request.url && cached.revision === revision) {
        entry = cached.entry;
      } else {
        entry = withAccess(windowAccess(context, project), () => mdk.mdkAttachment(project, grant.resource));
        // Keep at most one decrypted entry for successive range requests.
        if (Buffer.isBuffer(entry.data))
          context.bufferedPlayback = { url: request.url, revision, entry };
      }
    }
    const mime = mediaContainerType(entry.prefix(128 * 1024), previewMediaMime(grant.resource));
    if (!mime || previewMediaKind(mime) !== grant.kind)
      return new Response(null, { status: 415 });
    return serveMedia(request, entry, mime, grant.abort.signal);
  } catch {
    return new Response(null, { status: 404 });
  }
}
const counts: Record<keyof MdkCommands, [number, number]> = {
  packFont: [2, 2],
  readFont: [2, 2],
  publicationInfo: [1, 1],
  configurePublication: [3, 4],
  saveMdkPublication: [3, 3],
  planPublication: [2, 3],
  previewPdf: [2, 3],
  exportPublication: [4, 5],
  create: [2, 2],
  open: [1, 1],
  readEntry: [2, 2],
  saveEntry: [3, 3],
  addEntry: [2, 3],
  addGroup: [2, 3],
  indexFile: [2, 2],
  deleteEntry: [2, 2],
  renameEntry: [3, 3],
  reorderEntries: [2, 2],
  splitEntry: [2, 2],
  importResource: [3, 3],
  createResourceFolder: [4, 4],
  renameResource: [4, 4],
  deleteResource: [3, 3],
  importResourcesTo: [4, 4],
  extractResources: [3, 3],
  extractProjectFiles: [3, 3],
  insertResources: [3, 3],
  readText: [2, 2],
  readDocuments: [2, 2],
  saveText: [3, 3],
  addPublicationPreset: [3, 3],
  updateSettings: [2, 2],
  export: [2, 4],
  exportPlan: [1, 2],
  saveSnapshot: [2, 2],
  copyDraft: [3, 3],
  readingUnits: [1, 1],
  validate: [1, 1],
  readMode: [1, 1],
  readResource: [2, 2],
  setMode: [2, 2],
  checkPackDirectory: [1, 1],
  pack: [2, 2],
  unpack: [2, 2],
};
function registerDroppedFiles(context: DocumentWindow, paths: unknown) {
  const { droppedFiles } = context;
  if (
    !Array.isArray(paths) ||
    !paths.length ||
    paths.length > 16 ||
    paths.some(
      (p) => typeof p !== "string" || !path.isAbsolute(p) || p.length > 32768,
    )
  )
    throw new Error(t("拖入文件无效，一次最多 16 个文件。"));
  return registerInsertionSources(droppedFiles, paths);
}
function registerInsertionSources(
  droppedFiles: DocumentWindow["droppedFiles"],
  sources: InsertionSource[],
) {
  for (const [key, value] of droppedFiles)
    if (value.expires < Date.now()) droppedFiles.delete(key);
  if (droppedFiles.size >= 32) throw new Error(t("请完成当前资源操作后重试。"));
  const token = randomUUID();
  droppedFiles.set(token, { sources, expires: Date.now() + 60000 });
  setTimeout(() => droppedFiles.delete(token), 60000).unref();
  return {
    token,
    names: sources.map((source) =>
      typeof source === "string" ? path.basename(source) : source.name,
    ),
  };
}
function registerIpc() {
  ipcMain.handle("app:cancel-archive", (event) => {
    const state = verifySender(event).archiveJob;
    if (state) Atomics.compareExchange(state, 0, 0, 1);
  });
  ipcMain.handle("app:update", async (event, action: UpdateAction) => {
    verifySender(event);
    if (action === "status") return updates.status();
    if (action === "check") return updates.check();
    if (action === "download") return updates.download();
    if (action === "install") {
      const discarded: DiscardedUpdate[] = [];
      const result = await updates.install(() => prepareUpdate(discarded));
      if (result.phase === "downloaded")
        for (const { context, draft } of discarded) {
          if (context.window.isDestroyed()) continue;
          context.dirty = true;
          if (draft && context.activeProject)
            recover(context, context.activeProject, draft);
        }
      return result;
    }
    throw new Error(t("更新操作无效。"));
  });
  ipcMain.on("app:saved-for-update", (event, request, success) => {
    verifySender(event);
    const pending = updateSaves.get(request);
    if (pending?.sender === event.sender.id) pending.finish(success === true);
  });
  ipcMain.handle("app:register-drop", (event, paths) => {
    const context = verifySender(event);
    return registerDroppedFiles(context, paths);
  });
  ipcMain.handle("app:pick-document-resources", async (event) => {
    const context = verifySender(event);
    const result = await dialog.showOpenDialog(context.window, {
      title: t("插入本地资源"),
      properties: ["openFile", "multiSelections"],
      filters: isMarkdownFile(context.activeProject) ? [
        {
          name: t("支持的图片、音视频及 PDF"),
          extensions: Object.keys(insertionFormats).filter((extension) => insertionFormats[extension].kind !== "font"),
        },
      ] : undefined,
    });
    return result.canceled || !result.filePaths.length
      ? null
      : registerDroppedFiles(context, result.filePaths);
  });
  ipcMain.handle("app:paste-document-image", (event, bytes, mime) => {
    const { droppedFiles } = verifySender(event);
    if (
      !(bytes instanceof Uint8Array) ||
      !bytes.length ||
      bytes.length > 16 * 1024 * 1024
    )
      throw new Error(t("剪贴板图片为空或超过 16 MiB。"));
    const extension = Object.keys(insertionFormats).find(
      (key) =>
        insertionFormats[key].kind === "image" &&
        insertionFormats[key].mime === mime,
    );
    if (!extension) throw new Error(t("不支持此剪贴板图片格式。"));
    for (const [token, pending] of droppedFiles)
      if (typeof pending.sources[0] !== "string") droppedFiles.delete(token);
    return registerInsertionSources(droppedFiles, [
      {
        name: t("剪贴板图片.") + extension,
        bytes: Buffer.from(bytes),
      },
    ]);
  });
  ipcMain.handle("app:edit", (event, action, text) => {
    verifySender(event);
    if (action === "copy-text") {
      if (typeof text !== "string" || text.length > 16 * 1024 * 1024)
        throw new Error(t("复制内容无效或过大。"));
      clipboard.writeText(text);
      return;
    }
    if (action === "copy") event.sender.copy();
    else if (action === "cut") event.sender.cut();
    else if (action === "paste") event.sender.paste();
    else if (action === "paste-text") event.sender.pasteAndMatchStyle();
    else if (action === "select-all") event.sender.selectAll();
    else throw new Error(t("编辑命令无效。"));
  });
  ipcMain.handle("app:recovery", (event, file, value) => {
    const context = verifySender(event);
    assertApproved(context, file);
    if (
      value !== undefined &&
      value !== null &&
      (!value ||
        typeof value !== "object" ||
        typeof value.revision !== "string")
    )
      throw new Error(t("恢复草稿参数无效。"));
    const recovery = recover(context, file, value);
    return value === undefined ? recovery : null;
  });
  ipcMain.handle("app:inspect-envelope", (event, file) => {
    const context = verifySender(event);
    assertApproved(context, file);
    return probeEnvelope(file)
      ? envelopeWorker(context, { kind: "inspect", file: path.resolve(file) })
      : { kind: "plain" };
  });
  ipcMain.handle("app:cancel-envelope", (event) => {
    const context = verifySender(event);
    if (envelopeWork?.owner === context) envelopeWork.cancel();
  });
  ipcMain.handle("app:lock-envelope", (event, file) => {
    const context = verifySender(event);
    if (typeof file !== "string" || context.activeProject !== path.resolve(file) ||
      !context.access || context.dirty)
      throw new Error(t("请先保存未完成的更改，再锁定工程。"));
    context.access.key.fill(0);
    context.access = undefined;
    closeProjectViewers(context);
    context.stopWatching?.();
    context.stopWatching = undefined;
    persistDocumentPosition(context);
    context.activeProject = "";
    context.revisions.delete(path.resolve(file));
    context.window.setTitle("Mardikor");
  });
  ipcMain.handle("app:envelope", async (event, file, action: EnvelopeAction) => {
    const context = verifySender(event);
    assertApproved(context, file);
    file = path.resolve(file);
    if (!action || !["unlock", "set-access", "pack", "extract", "rekey"].includes(action.kind))
      throw new Error(t("封装操作参数无效。"));
    if (action.passphrase !== undefined && !(action.kind === "set-access" && action.passphrase === null))
      passwordBytes(action.passphrase).fill(0);
    if (action.kind === "rekey" && action.nextPassphrase !== undefined)
      passwordBytes(action.nextPassphrase).fill(0);
    const access = windowAccess(context, file);
    if (action.kind === "unlock") {
      if (typeof action.passphrase !== "string") throw new Error(t("此 MDK 需要访问口令。"));
      const value = await envelopeWorker(context, { kind: "unlock", file, passphrase: action.passphrase });
      if (!("access" in value) || !value.access) throw new Error(t("封装操作参数无效。"));
      try {
        await initEnvelopeCrypto();
        if (context.window.isDestroyed()) return;
        context.pendingAccess?.key.fill(0);
        context.pendingAccess = { ...value.access, file };
        return;
      } finally {
        if (context.pendingAccess?.key !== value.access.key) value.access.key.fill(0);
      }
    }
    if (action.kind === "set-access") {
      if (action.passphrase === undefined || !action.snapshot || !/\.mdk$/i.test(file))
        throw new Error(t("封装操作参数无效。"));
      const assertActive = () => {
        if (context.window.isDestroyed() || context.activeProject !== file ||
          state.hasOtherRecovery(file, context.recoveryOwner, access) ||
          [...windows.values()].some((other) => other !== context && other.activeProject === file))
          throw new Error(t("请先处理此工程的其他恢复草稿并关闭其他窗口。"));
      };
      assertActive();
      const revision = context.revisions.get(file);
      if (!revision || action.snapshot.revision !== revision) throw new mdk.MdkRevisionError();
      const value = await envelopeWorker(context, {
        kind: "set-access", file, passphrase: action.passphrase, access, revision, snapshot: action.snapshot,
      });
      if (!("bytes" in value)) throw new Error(t("封装操作参数无效。"));
      let adopted = false;
      try {
        await initEnvelopeCrypto();
        assertActive();
        if (!value.project) throw new Error(t("封装操作参数无效。"));
        const updated = publishEnvelopeOutput(file, file, value, true);
        let recoveryWarning: string | undefined;
        try {
          state.recovery(file, null, context.recoveryOwner, access);
        } catch (error) {
          recoveryWarning = t("旧恢复草稿清理失败：{0}", String(error));
        }
        context.access?.key.fill(0);
        context.access = value.access && { ...value.access, file };
        adopted = true;
        context.revisions.set(file, updated);
        return {
          project: { ...value.project, revision: updated, protected: Boolean(value.access) },
          recoveryWarning,
        } satisfies AccessChangeResult;
      } finally {
        if (!adopted) { value.access?.key.fill(0); value.bytes.fill(0); }
      }
    }
    assertApproved(context, action.output);
    if (!(action.kind === "extract" ? /\.mdk$/i : /\.mdke$/i).test(action.output))
      throw new Error(t("封装输出的文件扩展名无效。"));
    if (action.kind === "pack" && action.compression !== undefined && !isMdkeCompression(action.compression))
      throw new Error(t("MDKE 压缩配置无效。"));
    const task: EnvelopeTask = action.kind === "pack"
      ? { kind: "pack", file, passphrase: action.passphrase, access, allowOverlap: action.allowOverlap === true, compression: action.compression }
      : { kind: action.kind, file, passphrase: action.passphrase, nextPassphrase: action.kind === "rekey" ? action.nextPassphrase : undefined };
    const value = await envelopeWorker(context, task);
    if ("overlap" in value) return value;
    if (!("bytes" in value)) throw new Error(t("封装操作参数无效。"));
    if (context.window.isDestroyed()) {
      value.bytes.fill(0);
      return;
    }
    publishEnvelopeOutput(file, path.resolve(action.output), value);
    return value.report;
  });
  ipcMain.handle("app:open-url", (event, url) => {
    verifySender(event);
    if (
      typeof url !== "string" ||
      url.length > 8192 ||
      !/^https?:\/\/|^mailto:/i.test(url) ||
      containsControl(url)
    )
      throw new Error(t("禁止的导航协议。"));
    return shell.openExternal(url);
  });
  ipcMain.handle("app:open-markdown-link", async (event, href) => {
    const context = verifySender(event);
    if (typeof href !== "string" || !isMarkdownFile(context.activeProject))
      throw new Error(t("此窗口不能打开本地文件链接。"));
    const target = markdownFile.resolveMarkdownLink(
      context.activeProject,
      href,
    );
    if (isMarkdownFile(target.path)) createWindow(target.path, target.fragment);
    else {
      const error = await shell.openPath(target.path);
      if (error) throw new Error(t("无法用默认应用打开文件：{0}", error));
    }
  });
  ipcMain.handle("app:prepare-playback", (event, project, resource, kind) => {
    const context = verifySender(event);
    assertApproved(context, project);
    if (
      context.activeProject !== path.resolve(project) ||
      typeof resource !== "string" || resource.length > 65535 ||
      (kind !== "video" && kind !== "audio")
    ) throw new Error(t("媒体预览参数无效。"));
    validatePath(resource);
    const url = `${mediaScheme}://preview/${randomUUID()}`;
    context.playback.set(url, { resource, kind, abort: new AbortController() });
    return url;
  });
  ipcMain.handle("app:release-playback", (event, url) => {
    const context = verifySender(event);
    const grant = context.playback.get(url);
    if (!grant) return;
    grant.abort.abort();
    context.playback.delete(url);
    if (context.bufferedPlayback?.url === url)
      context.bufferedPlayback = undefined;
  });
  ipcMain.handle("app:open-media", (event, project, resource, kind) => {
    const context = verifySender(event);
    assertApproved(context, project);
    if (
      context.activeProject !== path.resolve(project) ||
      typeof resource !== "string" || resource.length > 65535 ||
      (kind !== "image" && kind !== "video" && kind !== "audio" && kind !== "attachment")
    ) throw new Error(t("媒体预览参数无效。"));
    const key = `${kind}:${resource}`;
    const existing = context.mediaWindows.get(key);
    if (existing) {
      if (!process.env.MARDIKOR_HEADLESS) {
        if (existing.isMinimized()) existing.restore();
        existing.show();
      }
      return;
    }
    const entry = withAccess(windowAccess(context, project), () =>
      isMarkdownFile(project)
        ? addedFile(resource, markdownFile.resolveLocalMarkdownPath(project, resource))
        : mdk.mdkAttachment(project, resource),
    );
    const window = openMediaWindow({
      owner: context.window, project, resource, kind, entry, devUrl,
      theme: state.preferences().appTheme ?? "light",
    });
    context.mediaWindows.set(key, window);
    window.once("closed", () => context.mediaWindows.delete(key));
  });
  ipcMain.handle("app:convert-markdown", async (event) => {
    const { window } = verifySender(event);
    const input = await dialog.showOpenDialog(window, {
      title: t("选择要转换的 Markdown"),
      properties: ["openFile"],
      filters: [{ name: t("Markdown 文件"), extensions: ["md", "markdown"] }],
    });
    const source = input.filePaths[0];
    if (input.canceled || !source || window.isDestroyed()) return false;
    const saved = await dialog.showSaveDialog(window, {
      title: t("保存转换后的 MDK"),
      defaultPath: path.join(path.dirname(source), path.parse(source).name + ".mdk"),
      filters: [{ name: t("MDK 工程"), extensions: ["mdk"] }],
    });
    if (saved.canceled || !saved.filePath) return false;
    const output = saved.filePath;
    await new Promise<void>((resolve, reject) => {
      const worker = new Worker(path.join(__dirname, "conversion-worker.cjs"), {
        workerData: { source, output, locale: appLocale() },
      });
      worker.once("message", () => resolve());
      worker.once("error", reject);
      worker.once("exit", (code) => reject(new Error(t("转换任务意外结束（{0}）。", code))));
    });
    state.remember(output, "00");
    createWindow(output);
    return true;
  });
  ipcMain.handle("app:reveal-file", (event, entry: unknown) => {
    const { activeProject } = verifySender(event);
    if (!activeProject || typeof entry !== "string")
      throw new Error(t("当前文件无效。"));
    const target =
      isMarkdownFile(activeProject) &&
      entry &&
      entry !== path.basename(activeProject)
        ? markdownFile.resolveLocalMarkdownPath(activeProject, entry)
        : activeProject;
    if (!fs.statSync(target, { throwIfNoEntry: false })?.isFile())
      throw new Error(t("当前文件不存在。"));
    shell.showItemInFolder(target);
  });
  ipcMain.handle("app:rename-archive", (event, name, revision, mode) => {
    const context = verifySender(event);
    const file = context.activeProject;
    if (
      !/\.mdk$/i.test(file) ||
      typeof name !== "string" ||
      name.length > 255 ||
      typeof mode !== "string" ||
      !/^[\da-f]{2}$/i.test(mode)
    )
      throw new Error(t("工程名称无效。"));
    assertApproved(context, file);
    if (
      typeof revision !== "string" ||
      revision !== context.revisions.get(file)
    )
      throw new mdk.MdkRevisionError();
    const target = mdk.mdkRenameTarget(file, name);
    if (target === file) return file;
    const sourcePath = fs.realpathSync.native(file);
    for (const other of windows.values()) {
      if (other === context) continue;
      const opened = other.activeProject || other.queuedFile;
      if (!opened) continue;
      let resolved: string;
      try {
        resolved = fs.realpathSync.native(opened);
      } catch {
        continue;
      }
      if (resolved === sourcePath)
        throw new Error(t("请先关闭其他打开此工程的窗口。"));
    }
    const access = windowAccess(context, file);
    const draft = recover(context, file);
    mdk.renameMdkArchive(file, target, revision);
    for (const other of windows.values()) {
      other.approvedFiles.delete(file);
      other.revisions.delete(file);
    }
    context.approvedFiles.add(target);
    context.revisions.set(target, revision);
    if (access) access.file = path.resolve(target);
    watchActiveProject(context, target);
    try {
      state.remember(target, mode, file);
      if (draft) {
        state.recovery(target, draft, context.recoveryOwner, access);
        state.recovery(file, null, context.recoveryOwner, access);
      }
    } catch (error) {
      console.error(error);
    }
    return target;
  });
  ipcMain.handle(
    "mdk:invoke",
    async (event, command: keyof MdkCommands, args: unknown[]) => {
      const context = verifySender(event);
      const handlers = createHandlers(context);
      const { revisions } = context;
      if (
        typeof command !== "string" ||
        !Object.hasOwn(handlers, command) ||
        !Array.isArray(args)
      )
        throw new Error(t("IPC 命令无效。"));
      const [minimum, maximum] = counts[command];
      if (args.length < minimum || args.length > maximum)
        throw new Error(t("IPC 参数数量无效。"));
      args.forEach((arg, index) => {
        if (
          index === 1 &&
          [
            "reorderEntries",
            "updateSettings",
            "saveSnapshot",
            "configurePublication",
            "saveMdkPublication",
          ].includes(command)
        )
          return;
        if (
          index === 2 &&
          (command === "addEntry" || command === "addGroup") &&
          arg === undefined
        )
          return;
        if (index === 2 && command === "insertResources") return;
        if (
          (index === 1 && command === "exportPlan") ||
          (index === 3 && command === "export")
        )
          return;
        if (
          index === 1 &&
          (command === "extractResources" ||
            command === "extractProjectFiles" ||
            command === "readDocuments")
        ) {
          if (
            !Array.isArray(arg) ||
            arg.length > 10000 ||
            arg.some((item) => typeof item !== "string" || item.length > 65535)
          )
            throw new Error(t("IPC 参数类型或大小无效。"));
          return;
        }
        if (index === 2 && command === "copyDraft") {
          if (!arg || typeof arg !== "object") throw new Error(t("草稿无效。"));
          return;
        }
        if (typeof arg !== "string" || arg.length > 16 * 1024 * 1024)
          throw new Error(t("IPC 参数类型或大小无效。"));
      });
      assertApproved(context, args[0]);
      if (
        [
          "export",
          "exportPublication",
          "copyDraft",
          "pack",
          "unpack",
          "importResource",
        ].includes(command)
      )
        assertApproved(context, args[1]);
      const source = path.resolve(args[0]);
      const mutating = [
        "configurePublication",
        "packFont",
        "saveMdkPublication",
        "saveEntry",
        "indexFile",
        "addEntry",
        "addGroup",
        "deleteEntry",
        "renameEntry",
        "reorderEntries",
        "splitEntry",
        "importResource",
        "insertResources",
        "saveText",
        "addPublicationPreset",
        "updateSettings",
        "setMode",
        "createResourceFolder",
        "renameResource",
        "deleteResource",
        "importResourcesTo",
        "saveSnapshot",
      ].includes(command);
      const threaded = archiveTasks.has(command) && !isMarkdownFile(source) &&
        !windowAccess(context, source) && context.pendingAccess?.file !== source &&
        (command === "pack" || command === "saveMdkPublication" || largeArchive(source) ||
          (command === "importResource" && largeArchive(args[1] as string)));
      if (
        mutating && !threaded && command !== "insertResources" && command !== "importResourcesTo" &&
        revisions.has(source) &&
        mdk.fileRevision(source) !== revisions.get(source)
      )
        throw new Error(
          t("磁盘工程已被其他进程修改；存在保存冲突，请重新打开或另存副本。"),
        );
      const standaloneHandlers: Partial<MdkCommands> = {
        packFont: handlers.packFont,
        readFont: markdownFile.readMarkdownFont,
        publicationInfo: handlers.publicationInfo,
        configurePublication: handlers.configurePublication,
        planPublication: handlers.planPublication,
        previewPdf: handlers.previewPdf,
        exportPublication: handlers.exportPublication,
        create: markdownFile.createMarkdownFile,
        open: markdownFile.openMarkdownFile,
        readText: markdownFile.readMarkdownFile,
        saveSnapshot: markdownFile.saveMarkdownSnapshot,
        copyDraft: markdownFile.copyMarkdownDraft,
        readResource: markdownFile.readMarkdownResource,
        insertResources: handlers.insertResources,
      };
      const handler =
        command !== "checkPackDirectory" &&
        command !== "pack" &&
        isMarkdownFile(source)
          ? standaloneHandlers[command]
          : handlers[command];
      if (!handler)
        throw new Error(t("此功能仅适用于 MDK 工程，单 Markdown 模式不可用。"));
      const opening = command === "open" || command === "create";
      const access = opening && context.pendingAccess?.file === source
        ? context.pendingAccess
        : windowAccess(context, source);
      let result: unknown;
      try {
        result = threaded
          ? await runArchiveTask(context, command as ArchiveTask, args, mutating ? revisions.get(source) : undefined)
          : await withAccess(access, () =>
          (handler as (...values: unknown[]) => unknown)(...args),
        );
      } catch (error) {
        if (opening) {
          context.pendingAccess?.key.fill(0);
          context.pendingAccess = undefined;
        }
        throw error;
      }
      if (opening) {
        if (context.access !== access) context.access?.key.fill(0);
        if (context.pendingAccess !== access) context.pendingAccess?.key.fill(0);
        context.pendingAccess = undefined;
        context.access = (result as { protected?: boolean }).protected ? access : undefined;
        if (!context.access) access?.key.fill(0);
        state.remember(
          args[0],
          isMarkdownFile(source)
            ? "markdown"
            : (result as { mode: string }).mode,
        );
        watchActiveProject(context, source);
      }
      if (
        result !== null &&
        (mutating || command === "open" || command === "create") &&
        fs.existsSync(source)
      )
        revisions.set(
          source,
          (
            result as
              { revision?: string; project?: { revision: string } } | undefined
          )?.revision ??
            (result as { project?: { revision: string } } | undefined)?.project
              ?.revision ??
            mdk.fileRevision(source),
        );
      return result;
    },
  );
  ipcMain.handle(
    "app:dialog",
    async (event, kind: DialogKind, defaultPath?: string) => {
      const context = verifySender(event);
      const { approvedFiles, publicationOutputs } = context;
      if (
        ![
          "open-project",
          "save-project",
          "save-markdown",
          "save-pdf",
          "save-epub",
          "save-mdke",
          "resource",
          "directory",
        ].includes(kind) ||
        (defaultPath !== undefined && typeof defaultPath !== "string")
      )
        throw new Error(t("文件对话框参数无效。"));
      const filters =
        kind === "save-mdke"
          ? [{ name: t("MDKE 分发包"), extensions: ["mdke"] }]
          : kind === "save-pdf" || kind === "save-epub"
          ? [
              {
                name: kind === "save-pdf" ? t("PDF 文档") : t("EPUB 电子书"),
                extensions: [kind === "save-pdf" ? "pdf" : "epub"],
              },
            ]
          : kind === "save-markdown"
            ? [{ name: t("Markdown 文件"), extensions: ["md"] }]
            : kind === "open-project"
              ? [
                  { name: "Mardikor / Markdown", extensions: ["mdk", "mdke", "md"] },
                  { name: t("MDKE 分发包"), extensions: ["mdke"] },
                  { name: t("MDK 工程"), extensions: ["mdk"] },
                  { name: t("Markdown 文件"), extensions: ["md"] },
                ]
              : [{ name: t("Mardikor 工程"), extensions: ["mdk"] }];
      let selected: string | undefined;
      if (
        ["save-project", "save-markdown", "save-pdf", "save-epub", "save-mdke"].includes(
          kind,
        )
      ) {
        const result = await dialog.showSaveDialog(context.window, {
          defaultPath:
            defaultPath ??
            (kind === "save-markdown" ? t("未命名.md") : t("未命名.mdk")),
          filters,
        });
        if (!result.canceled) selected = result.filePath;
      } else {
        const result = await dialog.showOpenDialog(context.window, {
          properties: [kind === "directory" ? "openDirectory" : "openFile"],
          ...(kind === "open-project" ? { filters } : {}),
        });
        if (!result.canceled) selected = result.filePaths[0];
      }
      if (selected) {
        approvedFiles.add(path.resolve(selected));
        if (kind === "save-pdf" || kind === "save-epub") {
          for (const [key, value] of publicationOutputs)
            if (value.expires < Date.now()) publicationOutputs.delete(key);
          publicationOutputs.set(path.resolve(selected), {
            revision: fs.existsSync(selected)
              ? mdk.fileRevision(selected)
              : null,
            expires: Date.now() + 300000,
          });
        }
      }
      return selected ?? null;
    },
  );
  ipcMain.handle("app:recent", (event) => {
    const context = verifySender(event);
    const recent = state.recent();
    // Recent items can be added by another window after this one was created.
    for (const file of recent)
      context.approvedFiles.add(path.resolve(file.path));
    return recent;
  });
  ipcMain.handle("app:document-position", (event, file) => {
    const context = verifySender(event);
    if (typeof file === "string" && context.activeProject === path.resolve(file))
      return state.documentPosition(context.activeProject);
  });
  ipcMain.on("app:track-document-position", (event, file, position) => {
    try {
      const context = verifySender(event);
      if (typeof file !== "string" || context.activeProject !== path.resolve(file) ||
          !isDocumentPosition(position)) return;
      validatePath(position.path);
      context.documentPosition = position;
    } catch {
      // Ignore malformed updates and windows already closing.
    }
  });
  ipcMain.handle("app:system-fonts", (event) => listSystemFonts(verifySender(event).window.webContents));
  ipcMain.handle("app:locale", (event) => {
    verifySender(event);
    return appLocale();
  });
  ipcMain.handle("app:preferences", (event, value?: Preferences) => {
    verifySender(event);
    const result = state.preferences(value);
    if (value) {
      for (const { window } of windows.values())
        if (!window.isDestroyed() && window.webContents.id !== event.sender.id)
          window.webContents.send("app:preferences-changed", result);
      if (app.isPackaged && !process.env.MARDIKOR_HEADLESS)
        void updates.automatic();
    }
    return result;
  });
  ipcMain.handle(
    "app:reading-preferences",
    (event, change?: import("../shared/reading").ReadingChange) => {
      verifySender(event);
      const value = state.readingPreferences(change);
      if (change !== undefined)
        for (const { window } of windows.values())
          if (
            !window.isDestroyed() &&
            window.webContents.id !== event.sender.id
          )
            window.webContents.send("app:reading-preferences-changed", value);
      return value;
    },
  );
  ipcMain.handle("app:window", (event, action: string) => {
    const { window } = verifySender(event);
    if (action === "minimize") window.minimize();
    else if (action === "maximize") {
      if (window.isMaximized()) window.unmaximize();
      else window.maximize();
    } else if (action === "close") window.close();
    else if (action !== "isMaximized") throw new Error(t("窗口操作无效。"));
    return !window.isDestroyed() && window.isMaximized();
  });
  ipcMain.on("app:dirty", (event, value) => {
    const context = verifySender(event);
    if (typeof value === "boolean") context.dirty = value;
  });
  ipcMain.on("app:saved-before-close", (event, success) => {
    const context = verifySender(event);
    if (success === true) {
      context.dirty = false;
      context.window.close();
    }
  });
  ipcMain.on("app:ready", (event) => {
    const context = verifySender(event);
    if (context.queuedFile) {
      context.window.webContents.send(
        "app:open-project",
        context.queuedFile,
        context.queuedFragment,
      );
      context.queuedFile = undefined;
      context.queuedFragment = undefined;
    }
  });
}
function openExternalProject(file: string) {
  if (!isSupportedDocument(file)) return;
  const full = path.resolve(file);
  if (!acceptingFiles) pendingFiles.push(full);
  else createWindow(full);
}
function openArguments(argv: string[], workingDirectory = process.cwd()) {
  for (const argument of argv)
    if (!argument.startsWith("-") && isSupportedDocument(argument))
      openExternalProject(path.resolve(workingDirectory, argument));
}
function createWindow(file?: string, fragment?: string) {
  const previous = pendingWindowSize ?? state.windowSize();
  // Electron reveals a hidden window when maximizing it. Keep that native
  // transition transparent and start Chromium at the final window size.
  const concealMaximize = Boolean(previous?.maximized && !process.env.MARDIKOR_HEADLESS && process.platform !== "linux");
  const focused = BrowserWindow.getFocusedWindow();
  const { workAreaSize } = focused
    ? screen.getDisplayMatching(focused.getBounds())
    : screen.getPrimaryDisplay();
  const minWidth = Math.min(1024, workAreaSize.width);
  const minHeight = Math.min(700, workAreaSize.height);
  const window = new BrowserWindow({
    title: "Mardikor",
    icon: path.join(app.getAppPath(), "assets/icon.png"),
    width: Math.min(
      workAreaSize.width,
      Math.max(minWidth, previous?.width ?? 1440),
    ),
    height: Math.min(
      workAreaSize.height,
      Math.max(minHeight, previous?.height ?? 940),
    ),
    minWidth,
    minHeight,
    frame: false,
    show: false,
    opacity: concealMaximize ? 0 : 1,
    backgroundColor: "#f4f6fa",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      partition: `workspace-${randomUUID()}`,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      // Tests can render animations without displaying their windows.
      offscreen: process.env.MARDIKOR_HEADLESS === "offscreen",
      backgroundThrottling: process.env.MARDIKOR_HEADLESS !== "offscreen",
    },
  });
  const context: DocumentWindow = {
    window,
    recoveryOwner: randomUUID(),
    dirty: false,
    activeProject: "",
    queuedFile: file,
    queuedFragment: fragment,
    approvedFiles: new Set(
      state.recent().map((recent) => path.resolve(recent.path)),
    ),
    revisions: new Map(),
    droppedFiles: new Map(),
    publicationOutputs: new Map(),
    mediaWindows: new Map(),
    playback: new Map(),
  };
  if (file) context.approvedFiles.add(file);
  const id = window.webContents.id;
  windows.set(id, context);
  const rememberSize = () => {
    if (window.isMinimized() || window.isFullScreen()) return;
    const { width, height } = window.getNormalBounds();
    pendingWindowSize = { width, height, maximized: window.isMaximized() };
    clearTimeout(windowSizeTimer);
    windowSizeTimer = setTimeout(persistWindowSize, 250);
  };
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.on("did-start-loading", () => closeProjectViewers(context));
  window.webContents.session.protocol.handle(mediaScheme, (request) =>
    servePreviewPlayback(context, request),
  );
  window.webContents.session.setPermissionRequestHandler(
    (contents, permission, callback, details) =>
      callback(contents.id === id && details.isMainFrame && isRendererUrl(contents.getURL()) &&
        (permission === "fullscreen" || permission === "local-fonts")),
  );
  window.webContents.session.setPermissionCheckHandler((contents, permission, _origin, details) =>
    contents?.id === id && details.isMainFrame && isRendererUrl(contents.getURL()) &&
      (permission === "fullscreen" || permission === "local-fonts"),
  );
  window.webContents.session.webRequest.onHeadersReceived(
    (details, callback) => {
      const script = devUrl ? "'self' 'unsafe-inline'" : "'self'";
      const connect = devUrl
        ? `${new URL(devUrl).origin} ${new URL(devUrl).origin.replace(/^http/, "ws")}`
        : "'self'";
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [
            `default-src 'self'; script-src ${script}; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob: ${mediaScheme}:; font-src 'self' data: ${mediaScheme}:; connect-src ${connect}; object-src 'none'; base-uri 'none'; frame-src 'none'`,
          ],
        },
      });
    },
  );
  window.on("close", (event) => {
    if (context.archiveJob) {
      event.preventDefault();
      context.closeAfterArchive = true;
      Atomics.compareExchange(context.archiveJob, 0, 0, 1);
      return;
    }
    if (context.dirty) {
      const choice = dialog.showMessageBoxSync(window!, {
        type: "question",
        buttons: [t("保存并关闭"), t("放弃更改并关闭"), t("取消")],
        defaultId: 0,
        cancelId: 2,
        title: t("尚有未保存的更改"),
        message: t("关闭后，未保存的工程更改和导出配置会丢失。"),
      });
      if (choice === 1 && context.activeProject)
        recover(context, context.activeProject, null);
      if (choice !== 1) {
        event.preventDefault();
        if (choice === 0) window?.webContents.send("app:save-before-close");
      }
    }
  });
  window.on("closed", () => {
    persistDocumentPosition(context);
    if (context.archiveJob) Atomics.compareExchange(context.archiveJob, 0, 0, 1);
    closeProjectViewers(context);
    if (envelopeWork?.owner === context) envelopeWork.cancel();
    context.access?.key.fill(0);
    context.pendingAccess?.key.fill(0);
    context.stopWatching?.();
    persistWindowSize();
    for (const pending of updateSaves.values())
      if (pending.sender === id) pending.finish(false);
    windows.delete(id);
    state.releaseRecovery(context.recoveryOwner);
  });
  window.once("ready-to-show", () => {
    if (previous?.maximized && !concealMaximize) window.maximize();
    context.readyToShow = true;
    if (!process.env.MARDIKOR_HEADLESS) {
      if (concealMaximize) window.setOpacity(1);
      window.show();
    }
    window.on("resize", rememberSize);
    const maximizedChanged = () => {
      rememberSize();
      window.webContents.send("app:window-maximized", window.isMaximized());
    };
    window.on("maximize", maximizedChanged);
    window.on("unmaximize", maximizedChanged);
    window.webContents.send("app:window-maximized", window.isMaximized());
  });
  window.webContents.on("did-start-loading", () => {
    context.queuedFile ??= context.activeProject || undefined;
  });
  if (concealMaximize) window.maximize();
  if (devUrl) void window.loadURL(devUrl);
  else void window.loadFile(rendererFile);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", (_event, argv, workingDirectory) => {
    const before = windows.size;
    openArguments(argv, workingDirectory);
    if (windows.size === before && acceptingFiles) {
      const window =
        BrowserWindow.getFocusedWindow() ??
        [...windows.values()].at(-1)?.window;
      if (window) {
        const context = windows.get(window.webContents.id);
        if (context && !context.readyToShow) return;
        if (window.isMinimized()) window.restore();
        window.show();
        window.focus();
      } else createWindow();
    }
  });
  app.on("open-file", (event, file) => {
    event.preventDefault();
    openExternalProject(file);
  });
  app
    .whenReady()
    .then(() => {
      const systemLocale = process.env.MARDIKOR_HEADLESS
        ? (process.env.MARDIKOR_TEST_SYSTEM_LOCALE ?? "zh-CN")
        : (app.getPreferredSystemLanguages()[0] ?? app.getLocale());
      setAppLocale(resolveAppLocale("system", systemLocale));
      state = new AppState(
        process.env.MARDIKOR_USER_DATA ?? app.getPath("userData"),
      );
      setAppLocale(
        resolveAppLocale(state.preferences().language, systemLocale),
      );
      const canInstallUpdate =
        app.isPackaged &&
        process.platform === "win32" &&
        !process.env.PORTABLE_EXECUTABLE_FILE;
      if (canInstallUpdate)
        process.env.MARDIKOR_UPDATE_INSTALL_DIR = path.dirname(
          app.getPath("exe"),
        );
      updates = new UpdateService(
        autoUpdater,
        {
          enabled: () => state.preferences().autoCheckUpdates !== false,
          lastChecked: () => state.updateCheck(),
          checked: (at) => {
            state.updateCheck(at);
          },
        },
        app.getVersion(),
        canInstallUpdate,
        (status) => {
          for (const context of windows.values())
            context.window.webContents.send("app:update-status", status);
        },
      );
      Menu.setApplicationMenu(null);
      registerIpc();
      // Queue all launch arguments before creating windows so no early OS open
      // event or second-instance request can overwrite another pending document.
      openArguments(process.argv);
      acceptingFiles = true;
      for (const file of pendingFiles.splice(0)) createWindow(file);
      if (!windows.size) createWindow();
      if (app.isPackaged && !process.env.MARDIKOR_HEADLESS) {
        setTimeout(() => void updates.automatic(), 5000).unref();
        setInterval(
          () => {
            if (windows.size) void updates.automatic();
          },
          60 * 60 * 1000,
        ).unref();
      }
      app.on("activate", () => {
        if (!windows.size) createWindow();
      });
    })
    .catch((error) => {
      dialog.showErrorBox(t("Mardikor 启动失败"), String(error));
      app.quit();
    });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
