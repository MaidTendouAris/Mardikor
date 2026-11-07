import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { DesktopApi } from "../shared/desktop";

import type { NativeDocumentDrop } from "../shared/resources";

const dropListeners = new Set<(drop: NativeDocumentDrop) => void>();
function isFileDrag(event: DragEvent) {
  return (
    event.dataTransfer?.types.includes("Files") ||
    !!event.dataTransfer?.files.length
  );
}
function fileDrag(event: DragEvent) {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (event.dataTransfer)
    event.dataTransfer.dropEffect =
      event.target instanceof Element &&
      event.target.closest("[data-document-drop-zone]")
        ? "copy"
        : "none";
}
function fileDrop(event: DragEvent) {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const listeners = [...dropListeners];
  const files = Array.from(event.dataTransfer?.files ?? []);
  const element =
    event.target instanceof Element
      ? event.target.closest<HTMLElement>("[data-document-drop-zone]")
      : null;
  const target = element?.dataset.documentDropZone as
    "source" | "write" | undefined;
  const point = {
    x: event.clientX,
    y: event.clientY,
    target: target ?? ("" as const),
    document: element?.dataset.documentPath,
    group: element?.closest<HTMLElement>("[data-editor-group]")?.dataset
      .editorGroup,
    names: files.map((file) => file.name),
  };
  const emit = (drop: NativeDocumentDrop) => {
    for (const listener of listeners)
      if (dropListeners.has(listener)) listener(drop);
  };
  if (!target) {
    emit({ ...point, error: "请将受支持的文件拖入可编辑的 Markdown 正文。" });
    return;
  }
  let paths: string[];
  try {
    paths = files.map((file) => webUtils.getPathForFile(file));
    if (!paths.length || paths.some((p) => !p))
      throw new Error("请从文件管理器拖入本地文件。");
  } catch (error) {
    emit({ ...point, error: String(error) });
    return;
  }
  void ipcRenderer
    .invoke("app:register-drop", paths)
    .then((result) => emit({ ...point, ...result }))
    .catch((error) => emit({ ...point, error: String(error) }));
}
// Install before renderer libraries: a native file drag must never start the
// directory tree's HTML5 backend while its terminal drop is handled here.
for (const type of ["dragenter", "dragover", "dragleave"])
  window.addEventListener(type, fileDrag as EventListener, true);
window.addEventListener("drop", fileDrop, true);

const api: DesktopApi = {
  update: (action) => ipcRenderer.invoke("app:update", action),
  onUpdate: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      status: import("../shared/updates").UpdateStatus,
    ) => callback(status);
    ipcRenderer.on("app:update-status", listener);
    return () => ipcRenderer.removeListener("app:update-status", listener);
  },
  onSaveForUpdate: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, request: string) => {
      void callback()
        .then((saved) =>
          ipcRenderer.send("app:saved-for-update", request, saved),
        )
        .catch(() => ipcRenderer.send("app:saved-for-update", request, false));
    };
    ipcRenderer.on("app:save-for-update", listener);
    return () => ipcRenderer.removeListener("app:save-for-update", listener);
  },
  edit: (action, text) => ipcRenderer.invoke("app:edit", action, text),
  pickDocumentResources: () =>
    ipcRenderer.invoke("app:pick-document-resources"),
  pasteDocumentImage: (bytes, mime) =>
    ipcRenderer.invoke("app:paste-document-image", bytes, mime),
  onDocumentDrop: (callback) => {
    dropListeners.add(callback);
    return () => {
      dropListeners.delete(callback);
    };
  },
  onProjectChanged: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      file: string,
      revision: string | null,
    ) => callback(file, revision);
    ipcRenderer.on("app:project-changed", listener);
    return () => ipcRenderer.removeListener("app:project-changed", listener);
  },
  invoke: (command, ...args) => ipcRenderer.invoke("mdk:invoke", command, args),
  dialog: (kind, defaultPath) =>
    ipcRenderer.invoke("app:dialog", kind, defaultPath),
  recent: () => ipcRenderer.invoke("app:recent"),
  preferences: (value) => ipcRenderer.invoke("app:preferences", value),
  window: (action) => ipcRenderer.invoke("app:window", action),
  setDirty: (dirty) => ipcRenderer.send("app:dirty", dirty),
  openExternal: (url) => ipcRenderer.invoke("app:open-url", url),
  openMarkdownLink: (href) =>
    ipcRenderer.invoke("app:open-markdown-link", href),
  onWindowMaximized: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, maximized: boolean) =>
      callback(maximized);
    ipcRenderer.on("app:window-maximized", listener);
    return () => ipcRenderer.removeListener("app:window-maximized", listener);
  },
  recovery: (path, value) => ipcRenderer.invoke("app:recovery", path, value),
  onSaveBeforeClose: (callback) => {
    const listener = () => {
      void callback()
        .then((success) => ipcRenderer.send("app:saved-before-close", success))
        .catch(() => ipcRenderer.send("app:saved-before-close", false));
    };
    ipcRenderer.on("app:save-before-close", listener);
    return () => ipcRenderer.removeListener("app:save-before-close", listener);
  },
  onOpenProject: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      file: string,
      fragment?: string,
    ) => callback(file, fragment);
    ipcRenderer.on("app:open-project", listener);
    ipcRenderer.send("app:ready");
    return () => ipcRenderer.removeListener("app:open-project", listener);
  },
};
contextBridge.exposeInMainWorld("mardikor", api);
