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
import * as mdk from "./mdk";
import type { InsertionSource } from "./insertion-assets";
import { AppState } from "./state";
import { containsControl } from "../shared/schema";
import { insertionFormats } from "../shared/resources";
import { isMarkdownFile, isSupportedDocument } from "../shared/workspace";
import * as markdownFile from "./markdown-file";
import { watchProjectFile } from "./project-watch";
import * as publication from "./publication";
import { publicationRuntime } from "./publication-runtime";
import { autoUpdater } from "electron-updater";
import { UpdateService } from "./update-service";
import type { UpdateAction } from "../shared/updates";
import type { MdkCommands, DialogKind, Preferences } from "../shared/desktop";

interface DocumentWindow {
  window: BrowserWindow;
  recoveryOwner: string;
  dirty: boolean;
  activeProject: string;
  queuedFile?: string;
  queuedFragment?: string;
  approvedFiles: Set<string>;
  revisions: Map<string, string>;
  stopWatching?: () => void;
  droppedFiles: Map<string, { sources: InsertionSource[]; expires: number }>;
  publicationOutputs: Map<string, { revision: string | null; expires: number }>;
}
const windows = new Map<number, DocumentWindow>();
const pendingFiles: string[] = [];
let acceptingFiles = false;
let state: AppState;
let updates: UpdateService;
let pendingWindowSize: Parameters<AppState["windowSize"]>[0];
let windowSizeTimer: ReturnType<typeof setTimeout> | undefined;
function persistWindowSize() {
  clearTimeout(windowSizeTimer);
  if (!pendingWindowSize) return;
  try {
    state.windowSize(pendingWindowSize);
  } catch (error) {
    console.error("无法保存窗口尺寸", error);
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
      title: "安装更新前处理未保存内容",
      message: `${path.basename(context.activeProject) || "当前窗口"} 有未保存的更改。`,
      detail: "安装更新将关闭所有 Mardikor 窗口。",
      buttons: ["保存并更新", "放弃更改并更新", "取消更新"],
      defaultId: 0,
      cancelId: 2,
    });
    if (response === 2) return false;
    if (response === 0 && !(await saveForUpdate(context))) return false;
    if (response === 1)
      discarded.push({
        context,
        draft: context.activeProject
          ? state.recovery(
              context.activeProject,
              undefined,
              context.recoveryOwner,
            )
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
      state.recovery(context.activeProject, null, context.recoveryOwner);
    context.dirty = false;
  }
  return true;
}
function createHandlers(context: DocumentWindow): MdkCommands {
  const { droppedFiles, publicationOutputs } = context;
  const exportRuntime = () =>
    publicationRuntime(state, (file) => {
      const key = path.resolve(file),
        approval = publicationOutputs.get(key);
      publicationOutputs.delete(key);
      if (!approval || approval.expires < Date.now())
        throw new Error("请选择 PDF / EPUB 输出文件并确认覆盖。");
      return approval.revision;
    });
  const handlers: MdkCommands = {
    publicationInfo: (file) =>
      publication.publicationInfo(file, exportRuntime()),
    configurePublication: (file, configuration, revision, format) =>
      publication.configurePublication(
        file,
        configuration,
        revision,
        exportRuntime(),
        format,
      ),
    planPublication: (file, format) =>
      publication.planPublication(file, format, exportRuntime()),
    exportPublication: (file, output, format, fingerprint) =>
      publication.exportPublication(
        file,
        output,
        format,
        fingerprint,
        exportRuntime(),
      ),
    create: mdk.createMdkProject,
    open: mdk.openMdkProject,
    readEntry: mdk.readMdkEntry,
    saveEntry: mdk.saveMdkEntry,
    addEntry: mdk.addMdkEntry,
    indexFile: mdk.addMdkReference,
    deleteEntry: mdk.deleteMdkEntry,
    renameEntry: mdk.renameMdkEntry,
    reorderEntries: mdk.reorderMdkEntries,
    splitEntry: mdk.splitMdkEntry,
    importResource: mdk.importMdkResource,
    insertResources: (file, token, insertion) => {
      const files = droppedFiles.get(token);
      droppedFiles.delete(token);
      if (!files || files.expires < Date.now())
        throw new Error("拖入文件授权已失效，请重新拖入。");
      return isMarkdownFile(file)
        ? markdownFile.insertMarkdownResources(file, files.sources, insertion)
        : mdk.insertMdkResources(file, files.sources, insertion);
    },
    readText: mdk.readMdkTextFile,
    saveText: mdk.saveMdkTextFile,
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
    createText: mdk.createTextFile,
    createDirectory: mdk.createProjectDirectory,
    renameFile: mdk.renameProjectFile,
    deleteFile: mdk.deleteProjectFile,
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
    throw new Error("不受信任的 IPC 来源。");
  const url = frame?.url ?? "";
  if (
    devUrl
      ? new URL(url).origin !== new URL(devUrl).origin
      : url.split(/[?#]/)[0] !== pathToFileURL(rendererFile).href
  )
    throw new Error("IPC 页面来源无效。");
  return context;
}
function assertApproved(
  context: DocumentWindow,
  file: unknown,
): asserts file is string {
  if (
    typeof file !== "string" ||
    !context.approvedFiles.has(path.resolve(file))
  )
    throw new Error("请通过文件对话框选择此路径。");
}
const counts: Record<keyof MdkCommands, [number, number]> = {
  publicationInfo: [1, 1],
  configurePublication: [3, 4],
  planPublication: [2, 2],
  exportPublication: [4, 4],
  create: [2, 2],
  open: [1, 1],
  readEntry: [2, 2],
  saveEntry: [3, 3],
  addEntry: [2, 3],
  indexFile: [2, 2],
  deleteEntry: [2, 2],
  renameEntry: [3, 3],
  reorderEntries: [2, 2],
  splitEntry: [2, 2],
  importResource: [3, 3],
  insertResources: [3, 3],
  readText: [2, 2],
  saveText: [3, 3],
  updateSettings: [2, 2],
  export: [2, 3],
  exportPlan: [1, 1],
  saveSnapshot: [2, 2],
  copyDraft: [3, 3],
  readingUnits: [1, 1],
  validate: [1, 1],
  readMode: [1, 1],
  readResource: [2, 2],
  setMode: [2, 2],
  createText: [3, 3],
  createDirectory: [2, 2],
  renameFile: [3, 3],
  deleteFile: [2, 2],
  checkPackDirectory: [1, 1],
  pack: [3, 3],
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
    throw new Error("拖入文件无效，一次最多 16 个文件。");
  return registerInsertionSources(droppedFiles, paths);
}
function registerInsertionSources(
  droppedFiles: DocumentWindow["droppedFiles"],
  sources: InsertionSource[],
) {
  for (const [key, value] of droppedFiles)
    if (value.expires < Date.now()) droppedFiles.delete(key);
  if (droppedFiles.size >= 32) throw new Error("请完成当前资源操作后重试。");
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
            state.recovery(context.activeProject, draft, context.recoveryOwner);
        }
      return result;
    }
    throw new Error("更新操作无效。");
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
      title: "插入本地资源",
      properties: ["openFile", "multiSelections"],
      filters: [
        {
          name: "支持的图片、音视频及 PDF",
          extensions: Object.keys(insertionFormats),
        },
      ],
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
      throw new Error("剪贴板图片为空或超过 16 MiB。");
    const extension = Object.keys(insertionFormats).find(
      (key) =>
        insertionFormats[key].kind === "image" &&
        insertionFormats[key].mime === mime,
    );
    if (!extension) throw new Error("不支持此剪贴板图片格式。");
    for (const [token, pending] of droppedFiles)
      if (typeof pending.sources[0] !== "string") droppedFiles.delete(token);
    return registerInsertionSources(droppedFiles, [
      {
        name: "剪贴板图片." + extension,
        bytes: Buffer.from(bytes),
      },
    ]);
  });
  ipcMain.handle("app:edit", (event, action, text) => {
    verifySender(event);
    if (action === "copy-text") {
      if (typeof text !== "string" || text.length > 16 * 1024 * 1024)
        throw new Error("复制内容无效或过大。");
      clipboard.writeText(text);
      return;
    }
    if (action === "copy") event.sender.copy();
    else if (action === "cut") event.sender.cut();
    else if (action === "paste") event.sender.paste();
    else if (action === "paste-text") event.sender.pasteAndMatchStyle();
    else if (action === "select-all") event.sender.selectAll();
    else throw new Error("编辑命令无效。");
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
      throw new Error("恢复草稿参数无效。");
    const recovery = state.recovery(file, value, context.recoveryOwner);
    return value === undefined ? recovery : null;
  });
  ipcMain.handle("app:open-url", (event, url) => {
    verifySender(event);
    if (
      typeof url !== "string" ||
      url.length > 8192 ||
      !/^https?:\/\/|^mailto:/i.test(url) ||
      containsControl(url)
    )
      throw new Error("禁止的导航协议。");
    return shell.openExternal(url);
  });
  ipcMain.handle("app:open-markdown-link", async (event, href) => {
    const context = verifySender(event);
    if (typeof href !== "string" || !isMarkdownFile(context.activeProject))
      throw new Error("此窗口不能打开本地文件链接。");
    const target = markdownFile.resolveMarkdownLink(
      context.activeProject,
      href,
    );
    if (isMarkdownFile(target.path)) createWindow(target.path, target.fragment);
    else {
      const error = await shell.openPath(target.path);
      if (error) throw new Error(`无法用默认应用打开文件：${error}`);
    }
  });
  ipcMain.handle(
    "mdk:invoke",
    (event, command: keyof MdkCommands, args: unknown[]) => {
      const context = verifySender(event);
      const handlers = createHandlers(context);
      const { revisions } = context;
      if (
        typeof command !== "string" ||
        !Object.hasOwn(handlers, command) ||
        !Array.isArray(args)
      )
        throw new Error("IPC 命令无效。");
      const [minimum, maximum] = counts[command];
      if (args.length < minimum || args.length > maximum)
        throw new Error("IPC 参数数量无效。");
      args.forEach((arg, index) => {
        if (
          index === 1 &&
          [
            "reorderEntries",
            "updateSettings",
            "saveSnapshot",
            "configurePublication",
          ].includes(command)
        )
          return;
        if (index === 2 && command === "addEntry" && arg === undefined) return;
        if (index === 2 && command === "insertResources") return;
        if (index === 2 && command === "copyDraft") {
          if (!arg || typeof arg !== "object") throw new Error("草稿无效。");
          return;
        }
        if (typeof arg !== "string" || arg.length > 16 * 1024 * 1024)
          throw new Error("IPC 参数类型或大小无效。");
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
        "saveEntry",
        "indexFile",
        "addEntry",
        "deleteEntry",
        "renameEntry",
        "reorderEntries",
        "splitEntry",
        "importResource",
        "insertResources",
        "saveText",
        "updateSettings",
        "setMode",
        "createText",
        "createDirectory",
        "renameFile",
        "deleteFile",
        "saveSnapshot",
      ].includes(command);
      if (
        mutating &&
        revisions.has(source) &&
        mdk.fileRevision(source) !== revisions.get(source)
      )
        throw new Error(
          "磁盘工程已被其他进程修改；存在保存冲突，请重新打开或另存副本。",
        );
      const standaloneHandlers: Partial<MdkCommands> = {
        publicationInfo: handlers.publicationInfo,
        configurePublication: handlers.configurePublication,
        planPublication: handlers.planPublication,
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
        throw new Error("此功能仅适用于 MDK 工程，单 Markdown 模式不可用。");
      const result = (handler as (...values: unknown[]) => unknown)(...args);
      if (command === "open" || command === "create") {
        state.remember(
          args[0],
          isMarkdownFile(source)
            ? "markdown"
            : (result as { mode: string }).mode,
        );
        if (context.activeProject !== source) {
          context.stopWatching?.();
          context.activeProject = source;
          let reportedRevision: string | null | undefined;
          context.stopWatching = watchProjectFile(source, (revision) => {
            if (
              context.window.isDestroyed() ||
              context.activeProject !== source
            )
              return;
            const changed = context.revisions.get(source) !== revision;
            if (reportedRevision === (changed ? revision : undefined)) return;
            reportedRevision = changed ? revision : undefined;
            context.window.webContents.send(
              "app:project-changed",
              source,
              revision,
            );
          });
        }
        context.window.setTitle(`${path.basename(source)} - Mardikor`);
      }
      if (
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
          "resource",
          "directory",
        ].includes(kind) ||
        (defaultPath !== undefined && typeof defaultPath !== "string")
      )
        throw new Error("文件对话框参数无效。");
      const filters =
        kind === "save-pdf" || kind === "save-epub"
          ? [
              {
                name: kind === "save-pdf" ? "PDF 文档" : "EPUB 电子书",
                extensions: [kind === "save-pdf" ? "pdf" : "epub"],
              },
            ]
          : kind === "save-markdown"
            ? [{ name: "Markdown 文件", extensions: ["md"] }]
            : kind === "open-project"
              ? [
                  { name: "Mardikor / Markdown", extensions: ["mdk", "md"] },
                  { name: "MDK 工程", extensions: ["mdk"] },
                  { name: "Markdown 文件", extensions: ["md"] },
                ]
              : [{ name: "Mardikor 工程", extensions: ["mdk"] }];
      let selected: string | undefined;
      if (
        ["save-project", "save-markdown", "save-pdf", "save-epub"].includes(
          kind,
        )
      ) {
        const result = await dialog.showSaveDialog(context.window, {
          defaultPath:
            defaultPath ??
            (kind === "save-markdown" ? "未命名.md" : "未命名.mdk"),
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
  ipcMain.handle("app:preferences", (event, value?: Preferences) => {
    verifySender(event);
    const result = state.preferences(value);
    if (value && app.isPackaged && !process.env.MARDIKOR_HEADLESS)
      void updates.automatic();
    return result;
  });
  ipcMain.handle("app:window", (event, action: string) => {
    const { window } = verifySender(event);
    if (action === "minimize") window.minimize();
    else if (action === "maximize") {
      if (window.isMaximized()) window.unmaximize();
      else window.maximize();
    } else if (action === "close") window.close();
    else if (action !== "isMaximized") throw new Error("窗口操作无效。");
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
  window.webContents.session.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
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
            `default-src 'self'; script-src ${script}; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; connect-src ${connect}; object-src 'none'; base-uri 'none'; frame-src 'none'`,
          ],
        },
      });
    },
  );
  window.on("close", (event) => {
    if (context.dirty) {
      const choice = dialog.showMessageBoxSync(window!, {
        type: "question",
        buttons: ["保存并关闭", "放弃更改并关闭", "取消"],
        defaultId: 0,
        cancelId: 2,
        title: "尚有未保存的更改",
        message: "关闭后，未保存的正文、源码或目录更改会丢失。",
      });
      if (choice === 1 && context.activeProject)
        state.recovery(context.activeProject, null, context.recoveryOwner);
      if (choice !== 1) {
        event.preventDefault();
        if (choice === 0) window?.webContents.send("app:save-before-close");
      }
    }
  });
  window.on("closed", () => {
    context.stopWatching?.();
    persistWindowSize();
    for (const pending of updateSaves.values())
      if (pending.sender === id) pending.finish(false);
    windows.delete(id);
    state.releaseRecovery(context.recoveryOwner);
  });
  window.once("ready-to-show", () => {
    if (previous?.maximized) window.maximize();
    if (!process.env.MARDIKOR_HEADLESS) window?.show();
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
      state = new AppState(
        process.env.MARDIKOR_USER_DATA ?? app.getPath("userData"),
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
        app.isPackaged &&
          process.platform === "win32" &&
          !process.env.PORTABLE_EXECUTABLE_FILE,
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
      dialog.showErrorBox("Mardikor 启动失败", String(error));
      app.quit();
    });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
