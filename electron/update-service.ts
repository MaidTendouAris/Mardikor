import type { AppUpdater } from "electron-updater";
import { releasePage, type UpdateStatus } from "../shared/updates";

export const updateInterval = 24 * 60 * 60 * 1000;
export interface UpdateStore {
  enabled(): boolean;
  lastChecked(): number;
  checked(at: number): void;
}
type Client = Pick<
  AppUpdater,
  | "on"
  | "autoDownload"
  | "autoInstallOnAppQuit"
  | "allowPrerelease"
  | "allowDowngrade"
  | "checkForUpdates"
  | "downloadUpdate"
  | "quitAndInstall"
>;

export class UpdateService {
  private value: UpdateStatus;
  private checking?: Promise<UpdateStatus>;
  private downloading?: Promise<UpdateStatus>;
  private installing = false;
  private downloadedVersion?: string;
  constructor(
    private client: Client,
    private store: UpdateStore,
    version: string,
    canInstall: boolean,
    private broadcast: (status: UpdateStatus) => void,
    private now = Date.now,
  ) {
    // Checking may run automatically. Downloads and installs never do.
    client.autoDownload = false;
    client.autoInstallOnAppQuit = false;
    client.allowPrerelease = false;
    client.allowDowngrade = false;
    this.value = {
      phase: "idle",
      currentVersion: version,
      lastChecked: store.lastChecked(),
      percent: 0,
      message: "尚未检查更新。",
      releaseNotes: "",
      releaseUrl: releasePage,
      canInstall,
    };
    client.on("update-available", (info) => {
      const notes =
        typeof info.releaseNotes === "string"
          ? info.releaseNotes
          : (info.releaseNotes ?? [])
              .map((note) => `${note.version}\n${note.note ?? ""}`)
              .join("\n\n");
      const downloaded = this.downloadedVersion === info.version;
      this.set({
        phase: downloaded ? "downloaded" : "available",
        latestVersion: info.version,
        releaseNotes: notes.slice(0, 12000),
        message: downloaded
          ? "更新已下载，等待手动安装。"
          : `发现新版本 ${info.version}，请手动下载。`,
      });
    });
    client.on("update-not-available", () =>
      this.set({
        phase: "current",
        latestVersion: undefined,
        releaseNotes: "",
        message: "当前已是最新版本。",
      }),
    );
    client.on("download-progress", (info) =>
      this.set({
        phase: "downloading",
        percent: Math.max(0, Math.min(100, info.percent)),
        message: "正在下载更新。",
      }),
    );
    client.on("update-downloaded", () => {
      this.downloadedVersion = this.value.latestVersion;
      this.set({
        phase: "downloaded",
        percent: 100,
        message: "更新已下载。点击安装并重启后，将沿用当前安装设置并自动重启。",
      });
    });
    client.on("error", (error) => this.fail(error));
  }
  status() {
    return { ...this.value };
  }
  private set(value: Partial<UpdateStatus>) {
    this.value = { ...this.value, ...value };
    this.broadcast(this.status());
  }
  private fail(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    this.set({
      phase: "error",
      message: `更新操作失败：${message.slice(0, 1200)}`,
    });
  }
  async automatic() {
    const last = this.store.lastChecked(),
      now = this.now();
    if (
      !this.store.enabled() ||
      (last > 0 && last <= now && now - last < updateInterval)
    )
      return this.status();
    return this.check();
  }
  check(): Promise<UpdateStatus> {
    if (this.checking) return this.checking;
    if (["downloading", "preparing"].includes(this.value.phase))
      return Promise.resolve(this.status());
    this.checking = (async () => {
      const at = this.now();
      try {
        this.store.checked(at);
        this.set({
          phase: "checking",
          lastChecked: at,
          latestVersion: undefined,
          releaseNotes: "",
          message: "正在检查 GitHub Releases…",
        });
        const result = await this.client.checkForUpdates();
        if (!result)
          this.set({
            phase: "idle",
            message: "当前运行环境不支持在线检查，请在正式安装版中检查更新。",
          });
      } catch (error) {
        this.fail(error);
      }
      return this.status();
    })().finally(() => {
      this.checking = undefined;
    });
    return this.checking;
  }
  download(): Promise<UpdateStatus> {
    if (this.downloading) return this.downloading;
    if (!this.value.canInstall)
      throw new Error("此版本请从发布页下载对应安装包或便携版。");
    if (
      !this.value.latestVersion ||
      !["available", "error"].includes(this.value.phase)
    )
      throw new Error("请先检查并选择可用更新。");
    this.set({ phase: "downloading", percent: 0, message: "正在下载更新。" });
    this.downloading = (async () => {
      try {
        await this.client.downloadUpdate();
      } catch (error) {
        this.fail(error);
      }
      return this.status();
    })().finally(() => {
      this.downloading = undefined;
    });
    return this.downloading;
  }
  async install(prepare: () => Promise<boolean>) {
    if (this.installing) return this.status();
    if (!this.value.canInstall || this.value.phase !== "downloaded")
      throw new Error("请先手动下载更新。");
    this.installing = true;
    this.set({
      phase: "preparing",
      message: "正在准备安装并处理所有窗口的未保存内容…",
    });
    try {
      if (!(await prepare())) {
        this.set({
          phase: "downloaded",
          message: "已取消安装。更新文件保留，文档仍保持打开。",
        });
        return this.status();
      }
      this.client.quitAndInstall(true, true);
    } catch (error) {
      this.set({
        phase: "downloaded",
        message: `安装未开始：${String(error).slice(0, 1000)}`,
      });
    } finally {
      this.installing = false;
    }
    return this.status();
  }
}
