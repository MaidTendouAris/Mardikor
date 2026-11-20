import { setAppLocale, t, type AppLocale } from "../shared/i18n";
import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { DesktopApi } from "../shared/desktop";

import type { NativeDocumentDrag, NativeDocumentDrop } from "../shared/resources";

const dropListeners = new Set<(drop: NativeDocumentDrop) => void>();
const dragListeners = new Set<(point: NativeDocumentDrag | null) => void>();
let dragPoint: NativeDocumentDrag | null = null;
let dragFrame = 0;
function reportDrag(point: NativeDocumentDrag | null) {
  dragPoint = point;
  if (!point) {
    if (dragFrame) cancelAnimationFrame(dragFrame);
    dragFrame = 0;
    for (const listener of dragListeners) listener(null);
    return;
  }
  if (dragFrame) return;
  dragFrame = requestAnimationFrame(() => {
    dragFrame = 0;
    for (const listener of dragListeners) listener(dragPoint);
  });
}
function dropZone(target: EventTarget | null) {
  return target instanceof Element
    ? target.closest<HTMLElement>("[data-document-drop-zone]")
    : null;
}
function documentPoint(event: DragEvent, zone: HTMLElement | null): NativeDocumentDrag {
  const mode = zone?.dataset.documentDropZone;
  return {
    x: event.clientX,
    y: event.clientY,
    target: mode === "source" || mode === "write" ? mode : "",
    document: zone?.dataset.documentPath,
    group: zone?.closest<HTMLElement>("[data-editor-group]")?.dataset.editorGroup,
  };
}

function isFileDrag(event: DragEvent) {
  return (
    event.dataTransfer?.types.includes("Files") ||
    !!event.dataTransfer?.files.length
  );
}
function fileDrag(event: DragEvent) {
  if (!isFileDrag(event) && !(event.type === "dragleave" && dragPoint)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const zone = dropZone(event.target);
  if (event.type === "dragleave") {
    if (!zone || zone !== dropZone(event.relatedTarget)) reportDrag(null);
    return;
  }
  if (event.dataTransfer)
    event.dataTransfer.dropEffect = zone ? "copy" : "none";
  const point = documentPoint(event, zone);
  reportDrag(point.target === "write" ? point : null);
}
function fileDrop(event: DragEvent) {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  reportDrag(null);
  const listeners = [...dropListeners];
  const files = Array.from(event.dataTransfer?.files ?? []);
  const point = {
    ...documentPoint(event, dropZone(event.target)),
    names: files.map((file) => file.name),
  };
  const emit = (drop: NativeDocumentDrop) => {
    for (const listener of listeners)
      if (dropListeners.has(listener)) listener(drop);
  };
  if (!point.target) {
    emit({
      ...point,
      error: t("请将受支持的文件拖入可编辑的 Markdown 正文。"),
    });
    return;
  }
  let paths: string[];
  try {
    paths = files.map((file) => webUtils.getPathForFile(file));
    if (!paths.length || paths.some((p) => !p))
      throw new Error(t("请从文件管理器拖入本地文件。"));
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
window.addEventListener("blur", () => reportDrag(null));
window.addEventListener("dragend", () => reportDrag(null), true);

const api: DesktopApi = {
  inspectEnvelope: (file) => ipcRenderer.invoke("app:inspect-envelope", file),
  envelope: (file, action) => ipcRenderer.invoke("app:envelope", file, action),
  lockEnvelope: (file) => ipcRenderer.invoke("app:lock-envelope", file),
  cancelEnvelope: () => ipcRenderer.invoke("app:cancel-envelope"),
  cancelArchive: () => ipcRenderer.invoke("app:cancel-archive"),
  onArchiveProgress: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: Parameters<typeof callback>[0]) => callback(progress);
    ipcRenderer.on("app:archive-progress", listener);
    return () => { ipcRenderer.removeListener("app:archive-progress", listener); };
  },
  convertMarkdown: () => ipcRenderer.invoke("app:convert-markdown"),
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
  onDocumentDrag: (callback) => {
    dragListeners.add(callback);
    return () => { dragListeners.delete(callback); };
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
  onPublicationProgress: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      file: string,
      stage: import("../shared/publication").PublicationStage,
    ) => callback(file, stage);
    ipcRenderer.on("app:publication-progress", listener);
    return () =>
      ipcRenderer.removeListener("app:publication-progress", listener);
  },
  invoke: (command, ...args) => ipcRenderer.invoke("mdk:invoke", command, args),
  dialog: (kind, defaultPath) =>
    ipcRenderer.invoke("app:dialog", kind, defaultPath),
  recent: () => ipcRenderer.invoke("app:recent"),
  locale: async () => {
    const locale: AppLocale = await ipcRenderer.invoke("app:locale");
    setAppLocale(locale);
    return locale;
  },
  preferences: (value) => ipcRenderer.invoke("app:preferences", value),
  readingPreferences: (change) =>
    ipcRenderer.invoke("app:reading-preferences", change),
  onReadingPreferencesChanged: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      value: Parameters<typeof callback>[0],
    ) => callback(value);
    ipcRenderer.on("app:reading-preferences-changed", listener);
    return () =>
      ipcRenderer.removeListener("app:reading-preferences-changed", listener);
  },
  onPreferencesChanged: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      value: Parameters<typeof callback>[0],
    ) => callback(value);
    ipcRenderer.on("app:preferences-changed", listener);
    return () =>
      ipcRenderer.removeListener("app:preferences-changed", listener);
  },
  window: (action) => ipcRenderer.invoke("app:window", action),
  setDirty: (dirty) => ipcRenderer.send("app:dirty", dirty),
  openExternal: (url) => ipcRenderer.invoke("app:open-url", url),
  renameArchive: (name, revision, mode) =>
    ipcRenderer.invoke("app:rename-archive", name, revision, mode),
  openMarkdownLink: (href) =>
    ipcRenderer.invoke("app:open-markdown-link", href),
  openMedia: (project, path, kind) =>
    ipcRenderer.invoke("app:open-media", project, path, kind),
  preparePlayback: (project, path, kind) =>
    ipcRenderer.invoke("app:prepare-playback", project, path, kind),
  releasePlayback: (url) => ipcRenderer.invoke("app:release-playback", url),
  revealFile: (path) => ipcRenderer.invoke("app:reveal-file", path),
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
