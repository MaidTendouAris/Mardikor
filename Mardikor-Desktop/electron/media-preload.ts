import { contextBridge, ipcRenderer } from "electron";
import type { MediaViewerApi } from "../shared/media-viewer";

const api: MediaViewerApi = {
  info: () => ipcRenderer.invoke("media:info"),
  window: (action) => ipcRenderer.invoke("media:window", action),
  onMaximized: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, maximized: boolean) =>
      callback(maximized);
    ipcRenderer.on("media:maximized", listener);
    return () => {
      ipcRenderer.removeListener("media:maximized", listener);
    };
  },
  save: () => ipcRenderer.invoke("media:save"),
  copyImage: (png) => ipcRenderer.invoke("media:copy-image", png),
};
contextBridge.exposeInMainWorld("mardikorMedia", api);
