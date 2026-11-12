import fs from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { serialize, deserialize } from "node:v8";
import type { SaveSnapshot } from "../shared/mdk";
import type { Preferences, RecentProject } from "../shared/desktop";
import {
  appThemes,
  defaultPageLength,
  minPageLength,
  maxPageLength,
} from "../shared/desktop";
import type { PublicationConfiguration } from "../shared/publication";
import { migrateShortcuts, shortcutError } from "../shared/shortcuts";
import { t, languagePreferences } from "../shared/i18n";
import {
  defaultReadingPreferences,
  maxReadingPresets,
  normalizeReadingPreferences,
  type ReadingChange,
  type ReadingPreferences,
} from "../shared/reading";

const defaults: Preferences = {
  autosave: true,
  autosaveInterval: 30,
  directorySyncThreshold: 200,
  externalOpenView: "preview",
  autoCheckUpdates: true,
  followOutline: true,
  appTheme: "light",
  pageLength: defaultPageLength,
  showPageMarkers: true,
  language: "system",
};
// A single 64 MiB Markdown entry can take twice its UTF-8 size in a
// serialized UTF-16 draft. Leave room for the surrounding snapshot metadata.
const recoveryLimit = 129 * 1024 * 1024;
function validPageLength(value: number | undefined) {
  return (
    value !== undefined &&
    Number.isInteger(value) &&
    value >= minPageLength &&
    value <= maxPageLength
  );
}
type WindowSize = { width: number; height: number; maximized: boolean };
export class AppState {
  private file: string;
  private value: {
    recent: RecentProject[];
    preferences: Preferences;
    reading: ReadingPreferences;
    updateLastChecked?: number;
    windowSize?: WindowSize;
  };
  private recoveryTargets = new Map<string, string>();
  private recoveryClaims = new Map<string, string>();
  constructor(directory: string) {
    this.file = path.join(directory, "workspace.json");
    this.value = {
      recent: [],
      preferences: { ...defaults },
      reading: defaultReadingPreferences,
    };
    if (fs.existsSync(this.file)) {
      const saved = JSON.parse(fs.readFileSync(this.file, "utf8"));
      this.value.reading = normalizeReadingPreferences(saved.reading);
      if (!Array.isArray(saved.recent))
        throw new Error(t("应用状态损坏，无法读取最近工程。"));
      this.value.recent = saved.recent
        .filter(
          (r: RecentProject) =>
            typeof r.path === "string" && typeof r.title === "string",
        )
        .slice(0, 20);
      const { readingTheme, ...preferences } = saved.preferences ?? {};
      const appTheme = preferences.appTheme ?? readingTheme;
      this.value.preferences = {
        ...defaults,
        ...preferences,
        appTheme: appThemes.includes(appTheme) ? appTheme : "light",
      };
      const size = saved.windowSize;
      if (
        size &&
        Number.isSafeInteger(size.width) &&
        size.width > 0 &&
        Number.isSafeInteger(size.height) &&
        size.height > 0
      )
        this.value.windowSize = {
          width: size.width,
          height: size.height,
          maximized: size.maximized === true,
        };
      if (typeof this.value.preferences.autoCheckUpdates !== "boolean")
        this.value.preferences.autoCheckUpdates = true;
      if (typeof this.value.preferences.followOutline !== "boolean")
        this.value.preferences.followOutline = true;
      if (!validPageLength(this.value.preferences.pageLength))
        this.value.preferences.pageLength = defaultPageLength;
      if (typeof this.value.preferences.showPageMarkers !== "boolean")
        this.value.preferences.showPageMarkers = true;
      if (
        !languagePreferences.includes(
          this.value.preferences.language ?? "system",
        )
      )
        this.value.preferences.language = "system";
      this.value.preferences.shortcuts = migrateShortcuts(
        this.value.preferences.shortcuts,
      );
      if (
        Number.isFinite(saved.updateLastChecked) &&
        saved.updateLastChecked >= 0
      )
        this.value.updateLastChecked = saved.updateLastChecked;
      if (
        !["preview", "source", "write"].includes(
          this.value.preferences.externalOpenView ?? "",
        )
      )
        this.value.preferences.externalOpenView = "preview";
    }
  }
  recent() {
    return this.value.recent;
  }
  windowSize(size?: WindowSize) {
    if (size) {
      this.value.windowSize = size;
      this.save();
    }
    return this.value.windowSize;
  }
  updateCheck(at?: number) {
    if (at !== undefined) {
      this.value.updateLastChecked = at;
      this.save();
    }
    return this.value.updateLastChecked ?? 0;
  }
  publication(
    file: string,
    value?: PublicationConfiguration,
  ): PublicationConfiguration | null {
    const dir = path.join(path.dirname(this.file), "publication"),
      target = path.join(
        dir,
        createHash("sha256").update(path.resolve(file)).digest("hex") + ".json",
      );
    if (!value)
      return fs.existsSync(target)
        ? JSON.parse(fs.readFileSync(target, "utf8"))
        : null;
    fs.mkdirSync(dir, { recursive: true });
    const temporary = target + "." + randomUUID() + ".tmp";
    try {
      fs.writeFileSync(temporary, JSON.stringify(value), { flag: "wx" });
      fs.renameSync(temporary, target);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
    return value;
  }
  recovery(
    file: string,
    value?: SaveSnapshot | null,
    owner?: string,
  ): SaveSnapshot | null {
    const dir = path.join(path.dirname(this.file), "recovery");
    const hash = createHash("sha256").update(path.resolve(file)).digest("hex");
    const key = owner ? `${owner}\0${hash}` : "";
    let target = owner
      ? this.recoveryTargets.get(key)
      : path.join(dir, hash + ".draft");
    if (!target) {
      // Claim one abandoned draft. Concurrent windows must never read, overwrite
      // or clear a draft already owned by another live window for the same file.
      const candidates = fs.existsSync(dir)
        ? fs
            .readdirSync(dir)
            .filter(
              (name) => name.startsWith(hash + ".") && name.endsWith(".draft"),
            )
            .map((name) => path.join(dir, name))
            .filter((name) => !this.recoveryClaims.has(name))
            .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
        : [];
      target = candidates[0] ?? path.join(dir, `${hash}.${randomUUID()}.draft`);
      this.recoveryTargets.set(key, target);
      this.recoveryClaims.set(target, owner!);
    }
    if (value === undefined) {
      if (!fs.existsSync(target)) return null;
      if (fs.statSync(target).size > recoveryLimit)
        throw new Error(t("恢复草稿超过实现支持范围。"));
      return deserialize(fs.readFileSync(target));
    }
    if (value === null) {
      if (fs.existsSync(target)) fs.unlinkSync(target);
      return null;
    }
    const data = serialize(value);
    if (data.length > recoveryLimit)
      throw new Error(t("恢复草稿超过 129 MiB 实现支持范围。"));
    fs.mkdirSync(dir, { recursive: true });
    const temporary = target + "." + randomUUID() + ".tmp";
    try {
      fs.writeFileSync(temporary, data, { flag: "wx" });
      fs.renameSync(temporary, target);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
    return value;
  }
  releaseRecovery(owner: string) {
    for (const [key, target] of this.recoveryTargets) {
      if (this.recoveryClaims.get(target) === owner) {
        this.recoveryTargets.delete(key);
        this.recoveryClaims.delete(target);
      }
    }
  }
  remember(file: string, mode: string, renamedFrom?: string) {
    const resolved = path.resolve(file);
    this.value.recent = [
      {
        path: resolved,
        title: path.basename(file).replace(/\.(mdk|md)$/i, ""),
        mode,
        updatedAt: new Date().toISOString(),
      },
      ...this.value.recent.filter(
        (p) => p.path !== resolved && p.path !== renamedFrom,
      ),
    ].slice(0, 20);
    this.save();
  }
  preferences(value?: Preferences) {
    if (value) {
      if (value.shortcuts !== undefined) {
        const error = shortcutError(value.shortcuts);
        if (error) throw new Error(error);
      }
      if (
        typeof value.autosave !== "boolean" ||
        !Number.isFinite(value.autosaveInterval) ||
        value.autosaveInterval < 5 ||
        value.autosaveInterval > 3600 ||
        !Number.isInteger(value.directorySyncThreshold) ||
        value.directorySyncThreshold < 1 ||
        (value.externalOpenView !== undefined &&
          !["preview", "source", "write"].includes(value.externalOpenView)) ||
        (value.autoCheckUpdates !== undefined &&
          typeof value.autoCheckUpdates !== "boolean") ||
        (value.followOutline !== undefined &&
          typeof value.followOutline !== "boolean") ||
        (value.pageLength !== undefined &&
          !validPageLength(value.pageLength)) ||
        (value.showPageMarkers !== undefined &&
          typeof value.showPageMarkers !== "boolean") ||
        (value.appTheme !== undefined && !appThemes.includes(value.appTheme)) ||
        (value.language !== undefined &&
          !languagePreferences.includes(value.language))
      )
        throw new Error(t("偏好设置无效。"));
      this.value.preferences = {
        ...this.value.preferences,
        ...value,
        externalOpenView:
          value.externalOpenView ??
          this.value.preferences.externalOpenView ??
          "preview",
      };
      this.save();
    }
    return this.value.preferences;
  }
  readingPreferences(change?: ReadingChange) {
    const previous = this.value.reading;
    if (change === undefined) return previous;
    if (!change || typeof change !== "object")
      throw new Error(t("阅读设置无效。"));
    const next = { ...previous, presets: [...previous.presets] };
    const index = "id" in change
      ? next.presets.findIndex(({ id }) => id === change.id)
      : -1;
    if (["rename", "update", "apply", "remove"].includes(change.kind) && index < 0)
      throw new Error(t("阅读预设不存在。"));
    if ((change.kind === "create" || change.kind === "rename") &&
      (typeof change.name !== "string" || !change.name.trim() || change.name.trim().length > 48))
      throw new Error(t("请输入 1 至 48 个字符的预设名称。"));
    switch (change.kind) {
      case "style":
        next.style = change.style;
        break;
      case "create":
        if (next.presets.length >= maxReadingPresets)
          throw new Error(t("最多可保存 {0} 个阅读预设。", maxReadingPresets));
        next.style = change.style;
        next.presets.push({ id: randomUUID(), name: change.name, style: change.style });
        break;
      case "rename":
        next.presets[index] = { ...next.presets[index], name: change.name };
        break;
      case "update":
        next.style = change.style;
        next.presets[index] = { ...next.presets[index], style: change.style };
        break;
      case "apply":
        next.style = next.presets[index].style;
        break;
      case "remove":
        next.presets.splice(index, 1);
        break;
      default:
        throw new Error(t("阅读设置无效。"));
    }
    this.value.reading = normalizeReadingPreferences(next);
    try {
      this.save();
    } catch (error) {
      this.value.reading = previous;
      throw error;
    }
    return this.value.reading;
  }
  private save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temp, JSON.stringify(this.value, null, 2), {
        flag: "wx",
      });
      fs.renameSync(temp, this.file);
    } finally {
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    }
  }
}
