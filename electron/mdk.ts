import { t } from "../shared/i18n";
import {
  normalizeMode,
  validatePath,
  validateContents,
  resolveSettings,
  inspectSettings,
  parseToml,
  stringifyToml as stringify,
  settingsChanges,
  merge,
  isTable,
  validateSourceText,
  type Table,
} from "../shared/schema";
export {
  normalizeMode,
  validatePath,
  validateContents,
  resolveSettings,
} from "../shared/schema";
import { randomUUID, createHash } from "node:crypto";
import { readArchive, checkNames, MAX_FILE, MAX_TOTAL } from "./archive";
import { resolveReference } from "../shared/references";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import AdmZip from "adm-zip";
import { loadInsertionAssets, type InsertionSource } from "./insertion-assets";
import { createMarkdownParser } from "../shared/markdown-parser";
import { bundledFontPath } from "../shared/publication";
import type Token from "markdown-it/lib/token.mjs";
import { defaultSettings } from "../shared/defaults";
import { comparePosition } from "../shared/outline";
import {
  buildOutline,
  serializeOutline,
  moveOutline,
  removeOutline,
} from "../shared/tree";
import { splitMarkdownByHeading } from "../shared/markdown";
import { checkMedia, detectMediaType } from "./media";
import {
  createResourceFolder, extractResourceEntries, importResourceFiles,
  resourceName, resourceNameIndex, resourcePath, selectResourceEntries,
} from "./resource-files";
import { isFixedResourceFolder } from "../shared/resources";
import { rewriteResourceLinks } from "./resource-references";
import type {
  MdkContents,
  MdkEntry,
  MdkProject,
  MdkSettings,
  MdkSummary,
  ValidationIssue,
  ValidationReport,
  EntryPositionUpdate,
  ResourceKind,
  ResourceInsertion,
  ResourceInsertionResult,
  ResourceFile,
  SaveSnapshot,
  ExportPlan,
} from "../shared/mdk";

export const MDK_MIMETYPE = "application/vnd.mardikor.mdk+zip";
type Document = {
  mode: string;
  zip: AdmZip;
  source?: string;
  revision?: string;
};
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const markdownParser = createMarkdownParser();
// Collect even disabled protocol targets for diagnostics; never render these tokens.
markdownParser.validateLink = () => true;
const text = (data: Buffer) => decoder.decode(data);
const hasControl = (value: string) =>
  [...value].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
export const fileRevision = (file: string) =>
  createHash("sha256").update(fs.readFileSync(file)).digest("hex");
export class MdkRevisionError extends Error {
  readonly code = "E_MDK_REVISION";
  constructor() {
    super(t("磁盘工程已被其他进程修改；保存冲突，请重新打开或另存副本。"));
  }
}
export class MdkLockedError extends Error {
  readonly code = "E_MDK_LOCKED";
  constructor(lock: string) {
    super(
      t(
        "工程正在写入，请稍后重试。若进程已退出，可用 mardikor unlock 检查遗留锁：",
      ) + lock,
    );
  }
}
function withMdkLock<T>(file: string, work: () => T): T {
  const lock = path.resolve(file) + ".mardikor-lock";
  try {
    fs.mkdirSync(lock, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new MdkLockedError(lock);
    throw error;
  }
  const owner = path.join(lock, randomUUID() + ".json");
  try {
    fs.writeFileSync(
      owner,
      JSON.stringify({
        pid: process.pid,
        host: os.hostname(),
        createdAt: new Date().toISOString(),
      }),
      { flag: "wx", mode: 0o600 },
    );
    return work();
  } finally {
    if (fs.existsSync(owner)) fs.unlinkSync(owner);
    fs.rmdirSync(lock);
  }
}

export function mdkRenameTarget(file: string, name: string) {
  const stem = name.trim().replace(/\.mdk$/i, "");
  resourceName(stem);
  return path.join(path.dirname(file), stem + ".mdk");
}

export function renameMdkArchive(file: string, target: string, revision: string) {
  return withMdkLock(file, () => {
    if (
      !fs.lstatSync(file, { throwIfNoEntry: false })?.isFile() ||
      fileRevision(file) !== revision
    )
      throw new MdkRevisionError();
    if (file === target) return;
    // On a case-insensitive volume both names may identify the same directory entry.
    if (
      fs.existsSync(target) &&
      fs.realpathSync.native(target) === fs.realpathSync.native(file) &&
      !fs.lstatSync(target).isSymbolicLink()
    ) {
      fs.renameSync(file, target);
      return;
    }
    withMdkLock(target, () => {
      try {
        fs.linkSync(file, target);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST")
          throw new Error(t("同名文件已存在，请使用其他名称。"));
        throw error;
      }
      try {
        fs.unlinkSync(file);
      } catch (error) {
        fs.unlinkSync(target);
        throw error;
      }
    });
  });
}
function requireExitedLockOwner(lock: string, pid: number) {
  if (!Number.isInteger(pid) || pid < 1 || pid > 0x7fffffff)
    throw new MdkLockedError(lock + t("（锁的 PID 无效）"));
  try {
    process.kill(pid, 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
    throw new MdkLockedError(lock + t("（无法确认持锁进程已退出）"));
  }
  throw new MdkLockedError(lock + t("（持锁进程仍在运行）"));
}
function lockOwnerText(owner: string) {
  const original = fs.lstatSync(owner, { throwIfNoEntry: false });
  if (!original?.isFile() || original.size > 1024)
    throw new MdkLockedError(owner + t("（锁的所有者无法确认）"));
  const unchanged = (current: fs.Stats | undefined) =>
    current?.isFile() &&
    current.dev === original.dev &&
    current.ino === original.ino &&
    current.size === original.size &&
    current.mtimeMs === original.mtimeMs &&
    current.birthtimeMs === original.birthtimeMs;
  const fd = fs.openSync(owner, "r");
  let text: string;
  try {
    if (!unchanged(fs.fstatSync(fd))) throw new MdkLockedError(owner);
    const bytes = Buffer.alloc(original.size);
    const count = fs.readSync(fd, bytes, 0, bytes.length, 0);
    if (count !== original.size) throw new MdkLockedError(owner);
    text = bytes
      .toString("utf8")
      .replace(/^\ufeff/, "")
      .trim();
  } finally {
    fs.closeSync(fd);
  }
  return {
    text,
    remove() {
      const current = fs.lstatSync(owner, { throwIfNoEntry: false });
      if (!unchanged(current))
        throw new MdkLockedError(owner + t("（锁已变化）"));
      fs.unlinkSync(owner);
    },
  };
}
export function unlockMdk(file: string) {
  const lock = path.resolve(file) + ".mardikor-lock";
  const info = fs.lstatSync(lock, { throwIfNoEntry: false });
  if (!info) return false;
  if (info.isFile()) {
    const legacy = lockOwnerText(lock);
    requireExitedLockOwner(
      lock,
      /^\d+$/.test(legacy.text) ? Number(legacy.text) : NaN,
    );
    legacy.remove();
    return true;
  }
  if (!info.isDirectory()) throw new MdkLockedError(lock + t("（锁类型无效）"));
  const entries = fs.readdirSync(lock);
  if (entries.length !== 1 || !/^[a-f0-9-]{36}\.json$/.test(entries[0]))
    throw new MdkLockedError(lock + t("（锁的所有者无法确认）"));
  const owner = lockOwnerText(path.join(lock, entries[0]));
  let data;
  try {
    data = JSON.parse(owner.text);
  } catch {
    throw new MdkLockedError(lock + t("（所有者记录无法解析）"));
  }
  if (data?.host !== os.hostname())
    throw new MdkLockedError(lock + t("（其他主机持锁或所有者无法确认）"));
  requireExitedLockOwner(lock, data.pid);
  // The unique marker keeps a competing unlocker from deleting a new writer's lock.
  owner.remove();
  fs.rmdirSync(lock);
  return true;
}
function load(file: string, expectedRevision?: string): Document {
  const size = fs.statSync(file).size;
  if (size < 2) throw new Error(t("MDK 文件头不完整。"));
  if (size > MAX_TOTAL)
    throw new Error(t("超出实现支持范围：容器超过 256 MiB。"));
  const data = fs.readFileSync(file),
    mode = normalizeMode(data.subarray(0, 2).toString("latin1")),
    revision = createHash("sha256").update(data).digest("hex");
  if (expectedRevision !== undefined && expectedRevision !== revision)
    throw new MdkRevisionError();
  return {
    mode,
    zip: readArchive(data.subarray(2)),
    source: path.resolve(file),
    revision,
  };
}
function assertEditable(doc: Document) {
  if (!["00", "01", "02"].includes(doc.mode))
    throw new Error(
      t(
        "未知 mode 的附加约束未验证，当前内容只读；请显式切换到 00 通用模式后编辑。",
      ),
    );
}

function readText(doc: Document, name: string) {
  validatePath(name);
  const entry = doc.zip.getEntry(name);
  if (!entry || entry.isDirectory)
    throw new Error(t("工程中没有文件：{0}", name));
  const data = entry.getData();
  if (!isTextData(data, name))
    throw new Error(t("二进制资源不能作为源码打开。"));
  const value = text(data);
  if (value.includes("\0")) throw new Error(t("二进制文件不能作为源码打开。"));
  return value;
}

function contents(doc: Document) {
  const value = parseToml(readText(doc, "contents.toml"));
  validateContents(value);
  return value;
}
function settingsInfo(doc: Document) {
  if (!doc.zip.getEntry("settings.toml"))
    return { settings: defaultSettings(), problems: [], readonly: false };
  try {
    return inspectSettings(parseToml(readText(doc, "settings.toml")));
  } catch (error) {
    return {
      settings: defaultSettings(),
      problems: [{ field: "settings.toml", message: String(error) }],
      readonly: false,
    };
  }
}
function settings(doc: Document) {
  return settingsInfo(doc).settings;
}

function summary(doc: Document): MdkSummary {
  const files = doc.zip.getEntries().filter((e) => !e.isDirectory);
  return {
    mode: doc.mode,
    entries: contents(doc).entries.length,
    files: files.length,
    resources: files.filter((e) => e.entryName.startsWith("resources/")).length,
  };
}

function project(doc: Document): MdkProject {
  return {
    revision: doc.revision ?? "",
    issues: diagnostics(doc),
    settings_readonly: settingsInfo(doc).readonly,
    readonly: !["00", "01", "02"].includes(doc.mode),
    mode: doc.mode,
    contents: contents(doc),
    settings: settings(doc),
    files: doc.zip.getEntries().map((e) => ({
      path: e.entryName.replace(/\/$/, ""),
      bytes: e.header.size,
      is_text: !e.isDirectory && isTextData(e.getData(), e.entryName),
      kind: e.isDirectory
        ? "directory"
        : ["contents.toml", "settings.toml", "mimetype"].includes(e.entryName)
          ? "control"
          : e.entryName.startsWith("markdown/")
            ? "markdown"
            : e.entryName.startsWith("resources/")
              ? "resource"
              : e.entryName.startsWith("meta/")
                ? "meta"
                : "other",
    })),
  };
}

function isTextData(data: Buffer, name = "") {
  if (
    /\.(pdf|zip|mdk|epub|png|jpe?g|webp|gif|bmp|mp[34]|aac|m4a|ogg|flac|wav|webm|ttf|otf|woff2?)$/i.test(
      name,
    )
  )
    return false;
  const media = detectMediaType(data);
  if (media && media !== "image/svg+xml") return false;
  try {
    const value = text(data);
    for (let i = 0; i < value.length; i++)
      if (value.charCodeAt(i) < 32 && !"\r\n\t".includes(value[i]))
        return false;
    return true;
  } catch {
    return false;
  }
}

function put(doc: Document, name: string, value: string | Buffer) {
  validatePath(name);
  doc.zip.addFile(
    name,
    typeof value === "string" ? Buffer.from(value, "utf8") : value,
  );
}

function putContents(doc: Document, value: MdkContents) {
  validateContents(
    value,
    new Set(doc.zip.getEntries().map((e) => e.entryName)),
  );
  put(doc, "contents.toml", stringify(value as unknown as Table));
}

function commit(
  file: string,
  doc: Document,
  options: { overwrite?: boolean; strict?: boolean } = {},
) {
  contents(doc);
  checkNames(
    doc.zip
      .getEntries()
      .map((e) => ({ name: e.entryName, directory: e.isDirectory })),
  );
  if (options.strict) {
    const errors = diagnostics(doc).filter((i) => i.severity === "error");
    if (errors.length) throw new Error(errors.map((i) => i.message).join("\n"));
  }
  // Rebuild so the first entry and its compression are deterministic. Unknown entries stay intact.
  const zip = new AdmZip(undefined, { noSort: true });
  zip.addFile("mimetype", Buffer.from(MDK_MIMETYPE));
  zip.getEntry("mimetype")!.header.method = 0;
  let total = MDK_MIMETYPE.length;
  for (const entry of doc.zip.getEntries()) {
    if (entry.entryName === "mimetype") continue;
    const bytes = entry.getData();
    total += bytes.length;
    if (bytes.length > MAX_FILE || total > MAX_TOTAL)
      throw new Error(t("工程超过大小限制。"));
    zip.addFile(entry.entryName, bytes, entry.comment, entry.attr);
  }
  const output = Buffer.concat([
    Buffer.from(normalizeMode(doc.mode), "ascii"),
    zip.toBuffer(),
  ]);
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, output, { flag: "wx", mode: 0o600 });
    const fd = fs.openSync(temporary, "r+");
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    const verified = load(temporary);
    project(verified);
    if (options.strict) {
      const errors = diagnostics(verified).filter(
        (issue) => issue.severity === "error",
      );
      if (errors.length)
        throw new Error(errors.map((issue) => issue.message).join("\n"));
    }
    withMdkLock(file, () => {
      if (
        doc.source === path.resolve(file) &&
        doc.revision &&
        fileRevision(file) !== doc.revision
      )
        throw new MdkRevisionError();
      if (options.overwrite === false) {
        try {
          fs.linkSync(temporary, file);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "EEXIST")
            throw new Error(
              t("目标文件已存在，未覆盖。请选择其他名称或显式启用覆盖偏好。"),
            );
          throw new Error(
            t("当前文件系统无法提供原子无覆盖发布，源工程保持不变：") +
              String(error),
          );
        }
      } else {
        if (process.platform !== "win32") {
          const previous = fs.statSync(file, { throwIfNoEntry: false });
          if (previous) fs.chmodSync(temporary, previous.mode & 0o777);
        }
        fs.renameSync(temporary, file);
      }
      doc.revision = verified.revision;
    });
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function entryById(doc: Document, id: string): MdkEntry {
  const entry = contents(doc).entries.find((e) => e.id === id);
  if (!entry) throw new Error(t("找不到目录项：{0}", id));
  return entry;
}

function uniqueName(
  doc: Document,
  directory: string,
  filename: string,
  except?: string,
) {
  if (
    !filename.trim() ||
    /[\\/:<>"|?*]/.test(filename) ||
    hasControl(filename) ||
    filename === "." ||
    filename === ".."
  )
    throw new Error(t("文件名为空或包含非法字符。"));
  let candidate = `${directory}/${filename}`;
  const extension = path.posix.extname(filename),
    stem = filename.slice(0, filename.length - extension.length);
  for (
    let index = 2;
    doc.zip.getEntry(candidate) && candidate !== except;
    index++
  )
    candidate = `${directory}/${stem}-${index}${extension}`;
  validatePath(candidate);
  return candidate;
}

export function createMdkProject(file: string, mode: string, overwrite = true) {
  const doc = {
    mode: normalizeMode(mode),
    zip: new AdmZip(undefined, { noSort: true }),
  };
  put(doc, "markdown/001.md", "# 001\n\n");
  putContents(doc, {
    schema_version: 1,
    entries: [{ id: randomUUID(), path: "markdown/001.md", position: "1" }],
  });
  put(doc, "settings.toml", stringify(defaultSettings() as unknown as Table));
  commit(file, doc, { overwrite });
  return openMdkProject(file);
}

export function openMdkProject(file: string) {
  return project(load(file));
}
// Conversion consumes one immutable, already safety-checked container snapshot.
export function readMdkPublication(file: string) {
  const doc = load(file);
  return {
    project: project(doc),
    units: [...contents(doc).entries]
      .sort((a, b) => comparePosition(a.position, b.position))
      .map((entry) => ({
        ...entry,
        markdown: doc.zip.getEntry(entry.path)
          ? readText(doc, entry.path)
          : null,
      })),
    files: new Map(
      doc.zip
        .getEntries()
        .filter((entry) => !entry.isDirectory)
        .map((entry) => [entry.entryName, entry.getData()]),
    ),
  };
}
export function configureMdkPublication(
  file: string,
  patch: Table,
  assets: { path: string; data: Buffer }[],
  revision?: string,
) {
  const doc = load(file, revision);
  assertEditable(doc);
  if (settingsInfo(doc).problems.length)
    throw new Error(t("请先修复 settings.toml，再保存导出配置。"));
  const old = doc.zip.getEntry("settings.toml")
    ? parseToml(readText(doc, "settings.toml"))
    : { schema_version: 1 };
  const next = merge(old, patch);
  resolveSettings(next);
  for (const asset of assets) {
    const existing = doc.zip.getEntry(asset.path);
    if (existing && !existing.getData().equals(asset.data))
      throw new Error(t("默认字体资源名称已被其他文件占用：") + asset.path);
    put(doc, asset.path, asset.data);
  }
  put(doc, "settings.toml", stringify(next));
  commit(file, doc);
  return project(doc);
}
export function readMdkMode(file: string) {
  return load(file).mode;
}
export function readMdkEntry(file: string, id: string) {
  const doc = load(file),
    entry = entryById(doc, id);
  return {
    revision: doc.revision!,
    entry_id: id,
    path: entry.path,
    markdown: readText(doc, entry.path),
  };
}
export function saveMdkEntry(file: string, id: string, markdown: string) {
  const doc = load(file),
    entry = entryById(doc, id);
  assertEditable(doc);
  put(doc, entry.path, markdown);
  commit(file, doc);
  return { entry_id: id, path: entry.path, markdown };
}
export function addMdkEntry(
  file: string,
  filename: string,
  afterId?: string,
  revision?: string,
  title?: string,
) {
  const doc = load(file, revision),
    control = contents(doc);
  control.entries.sort((a, b) => comparePosition(a.position, b.position));
  if (!filename) {
    let i = 1;
    while (doc.zip.getEntry(`markdown/${String(i).padStart(3, "0")}.md`)) i++;
    filename = `${String(i).padStart(3, "0")}.md`;
  }
  const name = uniqueName(
    doc,
    "markdown",
    filename.endsWith(".md") ? filename : `${filename}.md`,
  );
  const next =
    control.entries.reduce((max, entry) => {
      const number = BigInt(entry.position.split(".")[0]);
      return number > max ? number : max;
    }, 0n) + 1n;
  const added = withEntryTitle({ id: randomUUID(), path: name, position: String(next) }, title);
  const sibling = control.entries.find((entry) => entry.id === afterId);
  if (revision !== undefined && afterId !== undefined && !sibling)
    throw new Error(t("目录项不存在：") + afterId);
  control.entries.push(added);
  if (sibling)
    control.entries = moveOutline(
      control.entries,
      added.id,
      sibling.position,
      "after",
    );
  put(doc, name, `# ${title ?? path.posix.basename(name, ".md")}\n\n`);
  putContents(doc, control);
  assertEditable(doc);
  commit(file, doc);
  return project(doc);
}

function withEntryTitle(entry: MdkEntry, title?: string): MdkEntry {
  if (title === undefined) return entry;
  if (!title.trim() || hasControl(title) || /[\uD800-\uDFFF]/u.test(title))
    throw new Error(t("文稿显示名称不能为空或包含控制字符。"));
  return { ...entry, extensions: { mardikor: { display_name: title } } };
}
export function deleteMdkEntry(file: string, id: string, revision?: string) {
  const doc = load(file, revision),
    control = contents(doc),
    entry = entryById(doc, id);
  control.entries = removeOutline(control.entries, id);
  if (!control.entries.some((e) => e.path === entry.path))
    doc.zip.deleteFile(entry.path);
  putContents(doc, control);
  assertEditable(doc);
  commit(file, doc);
  return project(doc);
}
export function renameMdkEntry(
  file: string,
  id: string,
  filename: string,
  revision?: string,
) {
  const doc = load(file, revision),
    control = contents(doc),
    entry = control.entries.find((e) => e.id === id);
  if (!entry) throw new Error(t("目录项不存在。"));
  const name = uniqueName(
    doc,
    path.posix.dirname(entry.path),
    filename.endsWith(".md") ? filename : `${filename}.md`,
    entry.path,
  );
  const beforeIssues = new Set(
    referenceIssues(doc)
      .filter((i) => i.code === "E_RESOURCE_MISSING")
      .map((i) => i.path + "|" + i.message),
  );
  if (name !== entry.path) {
    put(doc, name, readText(doc, entry.path));
    const previous = entry.path;
    for (const item of control.entries)
      if (item.path === previous) item.path = name;
    doc.zip.deleteFile(previous);
  }
  putContents(doc, control);
  if (
    referenceIssues(doc).some(
      (i) =>
        i.code === "E_RESOURCE_MISSING" &&
        !beforeIssues.has(i.path + "|" + i.message),
    )
  )
    throw new Error(
      t(
        "重命名将破坏已知引用；无法无损同步引用，已保留原路径。请先在源码中调整依赖。",
      ),
    );
  assertEditable(doc);
  commit(file, doc);
  return project(doc);
}
export function reorderMdkEntries(
  file: string,
  updates: EntryPositionUpdate[],
) {
  if (
    !Array.isArray(updates) ||
    updates.some(
      (u) =>
        !isTable(u) ||
        typeof u.id !== "string" ||
        typeof u.position !== "string",
    )
  )
    throw new Error(t("目录更新格式无效。"));
  const doc = load(file),
    control = contents(doc);
  for (const update of updates) {
    const entry = control.entries.find((e) => e.id === update.id);
    if (!entry) throw new Error(t("目录项不存在：{0}", update.id));
    entry.position = update.position;
  }
  control.entries.sort((a, b) => comparePosition(a.position, b.position));
  putContents(doc, control);
  assertEditable(doc);
  commit(file, doc);
  return project(doc);
}
export function splitMdkEntry(file: string, id: string) {
  const doc = load(file),
    control = contents(doc),
    entry = entryById(doc, id);
  if (doc.mode !== "01" || !settings(doc).mode.book.split_by_heading)
    throw new Error(t("请先在书籍工程设置中启用“按标题拆分”。"));
  if (control.entries.filter((item) => item.path === entry.path).length !== 1)
    throw new Error(t("此文稿被多个目录项引用，请先解除重复引用再拆分。"));
  const parts = splitMarkdownByHeading(readText(doc, entry.path));
  if (parts.length < 2)
    throw new Error(t("至少需要两个同级的最浅层标题才能拆分。"));
  const nodes = buildOutline(control.entries);
  const insert = (siblings: ReturnType<typeof buildOutline>): boolean => {
    const index = siblings.findIndex((node) => node.entry?.id === id);
    if (index < 0) return siblings.some((node) => insert(node.children));
    const added = parts.slice(1).map((source, part) => {
      const name = uniqueName(
        doc,
        path.posix.dirname(entry.path),
        `${path.posix.basename(entry.path, ".md")}-${part + 2}.md`,
      );
      put(doc, name, source);
      return {
        position: "",
        entry: { id: randomUUID(), path: name, position: "" },
        children: [],
      };
    });
    siblings.splice(index + 1, 0, ...added);
    return true;
  };
  insert(nodes);
  put(doc, entry.path, parts[0]);
  control.entries = serializeOutline(nodes);
  putContents(doc, control);
  assertEditable(doc);
  commit(file, doc);
  return project(doc);
}
export function importMdkResource(
  file: string,
  source: string,
  kind: ResourceKind,
  revision?: string,
) {
  if (!["image", "video", "audio", "font", "other"].includes(kind))
    throw new Error(t("资源类型无效。"));
  if (fs.statSync(source).size >= 2 ** 32)
    throw new Error(t("v1 不支持 4 GiB 及以上资源。"));
  if (fs.statSync(source).size > MAX_FILE)
    throw new Error(t("超出实现支持范围：资源超过 64 MiB。"));
  const bytes = fs.readFileSync(source),
    doc = load(file, revision);
  checkMedia(source, bytes);
  const detected = detectMediaType(bytes);
  if (kind !== "other" && detected && !detected.startsWith(`${kind}/`))
    throw new Error(t("资源类型与实际文件格式不一致。"));
  const name = uniqueName(doc, `resources/${kind}`, path.basename(source));
  put(doc, name, bytes);
  assertEditable(doc);
  commit(file, doc);
  return { path: name, kind, bytes: bytes.length, revision: doc.revision! };
}

export function createMdkResourceFolder(file: string, parent: string, name: string, revision: string) {
  const doc = load(file, revision);
  assertEditable(doc);
  createResourceFolder(doc.zip, parent, name);
  commit(file, doc);
  return project(doc);
}

export function importMdkResourceBatch(file: string, parent: string, paths: string[], revision: string) {
  const doc = load(file, revision);
  assertEditable(doc);
  const count = importResourceFiles(doc.zip, parent, paths);
  commit(file, doc);
  return { project: project(doc), count };
}

export function prepareMdkResourceExtraction(file: string, paths: string[], revision: string, resourcesOnly = true) {
  const entries = selectResourceEntries(load(file, revision).zip, paths, resourcesOnly);
  const single = paths.length === 1 && entries.length === 1 && !entries[0].isDirectory &&
    entries[0].entryName === paths[0];
  return {
    filename: single ? path.posix.basename(entries[0].entryName) : undefined,
    extract: (output: string) => extractResourceEntries(entries, output, single, resourcesOnly),
  };
}

export function deleteMdkResource(file: string, source: string, revision: string) {
  resourcePath(source);
  if (isFixedResourceFolder(source)) throw new Error(t("资源分类目录由 Mardikor 管理。"));
  const doc = load(file, revision);
  assertEditable(doc);
  for (const entry of selectResourceEntries(doc.zip, [source]))
    doc.zip.deleteFile(entry.entryName);
  commit(file, doc);
  return project(doc);
}

export function renameMdkResource(file: string, source: string, name: string, revision: string) {
  resourcePath(source);
  resourceName(name);
  if (isFixedResourceFolder(source)) throw new Error(t("资源分类目录由 Mardikor 管理。"));
  const doc = load(file, revision);
  assertEditable(doc);
  const selected = selectResourceEntries(doc.zip, [source]);
  const target = path.posix.dirname(source) + "/" + name;
  if (target === source) return project(doc);
  const occupied = resourceNameIndex(doc.zip).get(target.normalize("NFC").toLowerCase());
  if (occupied && occupied !== source) throw new Error(t("目标路径已存在。"));
  const rename = (name: string) =>
    name === source || name.startsWith(source + "/")
      ? target + name.slice(source.length)
      : undefined;
  const copies = selected.map((entry) => {
    const next = rename(entry.entryName)!;
    const bytes = entry.getData();
    if (!entry.isDirectory) checkMedia(next, bytes);
    if ([bundledFontPath, "resources/other/Mardikor-Noto-OFL.txt"].includes(entry.entryName))
      throw new Error(t("内置字体及其许可证由 Mardikor 管理。"));
    return { old: entry.entryName, next, bytes, comment: entry.comment, attr: entry.attr };
  });
  for (const entry of doc.zip.getEntries()) {
    if (entry.isDirectory || !entry.entryName.startsWith("markdown/") ||
        !entry.entryName.endsWith(".md")) continue;
    const sourceText = text(entry.getData());
    if (!sourceText.includes("[")) continue;
    const updated = rewriteResourceLinks(markdownParser, entry.entryName, sourceText, rename);
    if (sourceText !== updated) put(doc, entry.entryName, updated);
  }
  if (doc.zip.getEntry("settings.toml")) {
    const sourceText = readText(doc, "settings.toml");
    let table: Table | undefined;
    try {
      table = parseToml(sourceText);
    } catch {
      if (sourceText.includes(source))
        throw new Error(t("无法安全更新 {0} 中的资源引用，已保留原路径。", "settings.toml"));
    }
    const extensions = table?.extensions;
    const mardikor = isTable(extensions) ? extensions.mardikor : undefined;
    const publication = isTable(mardikor) ? mardikor.publication : undefined;
    const metadata = isTable(publication) ? publication.metadata : undefined;
    const changes = new Map<string, { old: string; next: string }>();
    for (const [section, key] of [[table?.appearance, "font_family"], [metadata, "cover"]] as const) {
      if (!isTable(section) || typeof section[key] !== "string") continue;
      const next = rename(section[key]);
      if (!next) continue;
      if (table?.schema_version !== 1)
        throw new Error(t("无法安全更新 {0} 中的资源引用，已保留原路径。", "settings.toml"));
      changes.set(key, { old: section[key], next });
      section[key] = next;
    }
    if (changes.size) {
      const updated = sourceText.replace(
        /^([\t ]*["']?(font_family|cover)["']?[\t ]*=[\t ]*)("(?:\\[^\r\n]|[^"\\\r\n])*"|'[^'\r\n]*')/gm,
        (match, prefix: string, key: string, literal: string) => {
          const change = changes.get(key);
          if (!change || parseToml("resource = " + literal).resource !== change.old)
            return match;
          return prefix + JSON.stringify(change.next);
        },
      );
      if (!isDeepStrictEqual(parseToml(updated), table))
        throw new Error(t("无法安全更新 {0} 中的资源引用，已保留原路径。", "settings.toml"));
      put(doc, "settings.toml", updated);
    }
  }
  for (const { old } of copies) doc.zip.deleteFile(old);
  for (const { next, bytes, comment, attr } of copies)
    doc.zip.addFile(next, bytes, comment, attr);
  commit(file, doc);
  return project(doc);
}
export function readMdkTextFile(file: string, internalPath: string) {
  const doc = load(file);
  return {
    path: internalPath,
    content: readText(doc, internalPath),
    revision: doc.revision!,
  };
}
export function saveMdkTextFile(
  file: string,
  internalPath: string,
  content: string,
) {
  const doc = load(file);
  assertEditable(doc);
  if (internalPath === "settings.toml" && settingsInfo(doc).readonly)
    throw new Error(t("未知版本 settings 不可修改；可显式删除该可选文件。"));
  if (internalPath === "mimetype" && content !== MDK_MIMETYPE)
    throw new Error(t("mimetype 必须保持规范中的固定值。"));
  if (internalPath.endsWith(".toml")) {
    const value = parseToml(content);
    if (internalPath === "contents.toml")
      validateContents(
        value,
        new Set(doc.zip.getEntries().map((e) => e.entryName)),
      );
    if (internalPath === "settings.toml") resolveSettings(value);
  }
  if (internalPath.endsWith(".json")) JSON.parse(content);
  const existing = doc.zip.getEntry(internalPath);
  if (existing) readText(doc, internalPath);
  else if (!isTextData(Buffer.from(content), internalPath))
    throw new Error(t("只能创建 UTF-8 纯文本文件。"));
  put(doc, internalPath, content);
  commit(file, doc);
  return { path: internalPath, content };
}
export function updateMdkSettings(file: string, value: MdkSettings) {
  resolveSettings(value);
  const doc = load(file);
  assertEditable(doc);
  if (settingsInfo(doc).readonly)
    throw new Error(
      t("未知版本 settings 仅允许原样保留或显式删除，不能降写。"),
    );
  let old: Table = { schema_version: 1 };
  try {
    if (doc.zip.getEntry("settings.toml"))
      old = parseToml(readText(doc, "settings.toml"));
  } catch {
    /* The settings form can repair malformed TOML. */
  }
  put(doc, "settings.toml", stringify(merge(old, settingsChanges(old, value))));
  commit(file, doc);
  return project(doc);
}

export function setMdkMode(file: string, mode: string) {
  const doc = load(file);
  doc.mode = normalizeMode(mode);
  commit(file, doc);
  return project(doc);
}
export function createTextFile(
  file: string,
  internalPath: string,
  content: string,
) {
  validatePath(internalPath);
  const doc = load(file);
  if (doc.zip.getEntry(internalPath) || doc.zip.getEntry(internalPath + "/"))
    throw new Error(t("文件或目录已存在。"));
  if (internalPath.startsWith("markdown/") && !internalPath.endsWith(".md"))
    throw new Error(t("markdown/ 正文仅支持 .md 文件。"));
  if (!isTextData(Buffer.from(content), internalPath))
    throw new Error(t("只能创建 UTF-8 纯文本文件。"));
  validateSourceText(
    internalPath,
    content,
    new Set([...doc.zip.getEntries().map((e) => e.entryName), internalPath]),
  );
  put(doc, internalPath, content);
  assertEditable(doc);
  commit(file, doc);
  return project(doc);
}
export function addMdkReference(file: string, internalPath: string) {
  validatePath(internalPath);
  if (!internalPath.startsWith("markdown/") || !internalPath.endsWith(".md"))
    throw new Error(t("只能将 markdown/ 下的 .md 文稿加入目录。"));
  const doc = load(file);
  assertEditable(doc);
  readText(doc, internalPath);
  const control = contents(doc),
    next =
      control.entries.reduce((max, entry) => {
        const number = BigInt(entry.position.split(".")[0]);
        return number > max ? number : max;
      }, 0n) + 1n;
  control.entries.push({
    id: randomUUID(),
    path: internalPath,
    position: String(next),
  });
  putContents(doc, control);
  commit(file, doc);
  return project(doc);
}
export function createProjectDirectory(file: string, internalPath: string) {
  validatePath(internalPath);
  const doc = load(file);
  if (doc.zip.getEntry(internalPath) || doc.zip.getEntry(internalPath + "/"))
    throw new Error(t("文件或目录已存在。"));
  doc.zip.addFile(internalPath + "/", Buffer.alloc(0));
  assertEditable(doc);
  commit(file, doc);
  return project(doc);
}
export function renameProjectFile(
  file: string,
  internalPath: string,
  newPath: string,
) {
  validatePath(internalPath);
  validatePath(newPath);
  if (
    ["mimetype", "contents.toml"].includes(internalPath) ||
    ["mimetype", "contents.toml"].includes(newPath)
  )
    throw new Error(t("不能重命名关键工程文件。"));
  if (newPath.startsWith(internalPath + "/"))
    throw new Error(t("不能将目录移入自身。"));
  const doc = load(file),
    control = contents(doc);
  if (
    doc.zip.getEntry(newPath) ||
    doc.zip.getEntry(newPath + "/") ||
    doc.zip.getEntries().some((e) => e.entryName.startsWith(newPath + "/"))
  )
    throw new Error(t("目标路径已存在。"));
  const selected = doc.zip
    .getEntries()
    .filter(
      (e) =>
        e.entryName === internalPath ||
        e.entryName.startsWith(internalPath + "/"),
    );
  if (!selected.length) throw new Error(t("文件或目录不存在。"));
  const copies = selected.map((e) => ({
    old: e.entryName,
    next: newPath + e.entryName.slice(internalPath.length),
    bytes: e.getData(),
    attr: e.attr,
  }));
  copies.forEach((e) => doc.zip.deleteFile(e.old));
  copies.forEach((e) => doc.zip.addFile(e.next, e.bytes, "", e.attr));
  for (const entry of control.entries)
    if (
      entry.path === internalPath ||
      entry.path.startsWith(internalPath + "/")
    )
      entry.path = newPath + entry.path.slice(internalPath.length);
  putContents(doc, control);
  const beforeIssues = new Set(
    referenceIssues(load(file))
      .filter((i) => i.code === "E_RESOURCE_MISSING")
      .map((i) => i.path + "|" + i.message),
  );
  if (
    referenceIssues(doc).some(
      (i) =>
        i.code === "E_RESOURCE_MISSING" &&
        !beforeIssues.has(i.path + "|" + i.message),
    )
  )
    throw new Error(
      t(
        "重命名将破坏已知引用；无法无损同步引用，已保留原路径。请先在源码中调整依赖。",
      ),
    );
  assertEditable(doc);
  commit(file, doc);
  return project(doc);
}
export function deleteProjectFile(file: string, internalPath: string) {
  validatePath(internalPath);
  if (["mimetype", "contents.toml"].includes(internalPath))
    throw new Error(t("不能删除关键工程文件。"));
  const doc = load(file),
    control = contents(doc);
  const removedIds = control.entries
    .filter(
      (e) => e.path === internalPath || e.path.startsWith(internalPath + "/"),
    )
    .map((e) => e.id);
  for (const id of removedIds)
    control.entries = removeOutline(control.entries, id);
  for (const entry of doc.zip.getEntries())
    if (
      entry.entryName === internalPath ||
      entry.entryName.startsWith(internalPath + "/")
    )
      doc.zip.deleteFile(entry.entryName);
  putContents(doc, control);
  assertEditable(doc);
  commit(file, doc);
  return project(doc);
}

function referenceIssues(doc: Document): ValidationIssue[] {
  const issues: ValidationIssue[] = [],
    used = new Set<string>();
  const files = new Set(
    doc.zip
      .getEntries()
      .filter((e) => !e.isDirectory)
      .map((e) => e.entryName),
  );
  const check = (source: string, url: string, media = false) => {
    const target = resolveReference(source, url, media);
    if (target.kind === "unsafe") {
      issues.push({
        severity: "error",
        code: "E_REFERENCE_UNSAFE",
        path: source,
        message: target.message,
      });
      return;
    }
    if (target.kind === "external") {
      if (target.media)
        issues.push({
          severity: "error",
          code: "E_EXTERNAL_MEDIA",
          path: source,
          message: t("portable 交付需要包内媒体：") + url,
        });
      return;
    }
    used.add(target.path);
    if (!files.has(target.path))
      issues.push({
        severity: "error",
        code: "E_RESOURCE_MISSING",
        path: source,
        message: t("本地引用的文件不存在：") + target.path,
      });
  };
  const font = settings(doc).appearance.font_family;
  if (font === bundledFontPath && files.has(font))
    used.add("resources/other/Mardikor-Noto-OFL.txt");
  if (font.startsWith("resources/font/")) {
    used.add(font);
    if (!files.has(font))
      issues.push({
        severity: "error",
        code: "E_RESOURCE_MISSING",
        path: "settings.toml",
        message: t("引用的字体不存在：") + font,
      });
  }
  for (const entry of doc.zip
    .getEntries()
    .filter(
      (e) => e.entryName.startsWith("markdown/") && e.entryName.endsWith(".md"),
    )) {
    let source: string;
    try {
      source = text(entry.getData());
    } catch (error) {
      issues.push({
        severity: "error",
        code: "E_TEXT_ENCODING",
        path: entry.entryName,
        message: String(error),
      });
      continue;
    }
    const walk = (tokens: Token[]) => {
      for (const token of tokens) {
        const url =
          token.type === "image"
            ? token.attrGet("src")
            : token.type === "link_open"
              ? token.attrGet("href")
              : null;
        if (url !== null) check(entry.entryName, url, token.type === "image");
        if (token.children) walk(token.children);
      }
    };
    if (source.includes("[") || source.includes("<"))
      walk(markdownParser.parse(source, {}));
  }
  for (const name of files)
    if (name.startsWith("resources/") && !used.has(name))
      issues.push({
        severity: "info",
        code: "W_RESOURCE_ORPHAN",
        path: name,
        message: t("未发现已知引用；作为附件保留，不自动清理。"),
      });
  return issues;
}
function diagnostics(doc: Document): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const control = contents(doc),
    paths = new Set(
      doc.zip
        .getEntries()
        .filter((e) => !e.isDirectory)
        .map((e) => e.entryName),
    );
  if (!["00", "01", "02"].includes(doc.mode))
    issues.push({
      severity: "warning",
      code: "W_MODE_UNKNOWN",
      message:
        t("未知 mode ") +
        doc.mode +
        t(
          "：仅校验 default 基础规则，附加约束未验证；内容只读，原用途与未知数据保留。",
        ),
    });
  for (const entry of control.entries)
    if (!paths.has(entry.path))
      issues.push({
        severity: "error",
        code: "E_CONTENT_MISSING",
        path: entry.path,
        message: t(
          "目录指向的文稿缺失；允许保存未完成工程，交付前需恢复文件或删除条目。",
        ),
      });
  for (const problem of settingsInfo(doc).problems)
    issues.push({
      severity: "error",
      code: "E_SETTINGS",
      path: "settings.toml",
      message: problem.message,
    });
  if (!doc.zip.getEntry("settings.toml"))
    issues.push({
      severity: "info",
      code: "I_SETTINGS_DEFAULT",
      message: t("settings.toml 缺省，按规范默认值解释，不写回源文件。"),
    });
  const prefs = settings(doc).export;
  if (prefs.default_target !== "mdk" || prefs.mdk.package_mode !== "portable")
    issues.push({
      severity: "warning",
      code: "W_EXPORT_PRESET",
      message: t("不支持的交付偏好已保留；当前仅支持 portable MDK。"),
    });
  if (!prefs.preserve_source_names)
    issues.push({
      severity: "warning",
      code: "W_NAMES_RETAINED",
      message: t("无法保证未知扩展中的全部引用同步，交付副本保留源文件名。"),
    });
  for (const item of doc.zip.getEntries())
    if (!item.isDirectory && item.entryName.startsWith("resources/"))
      try {
        checkMedia(item.entryName, item.getData());
      } catch (error) {
        issues.push({
          severity: "error",
          code: "E_MEDIA",
          path: item.entryName,
          message: String(error),
        });
      }
  issues.push(...referenceIssues(doc));
  const unknown = (shape: Table, value: Table): boolean =>
    Object.entries(value).some(
      ([key, current]) =>
        !(key in shape) ||
        (isTable(shape[key]) &&
          isTable(current) &&
          unknown(shape[key], current)),
    );
  let extension =
    Object.keys(control).some(
      (key) => !["schema_version", "entries"].includes(key),
    ) ||
    control.entries.some((entry) =>
      Object.keys(entry).some(
        (key) => !["id", "path", "position"].includes(key),
      ),
    );
  try {
    if (doc.zip.getEntry("settings.toml"))
      extension =
        extension ||
        unknown(
          defaultSettings() as unknown as Table,
          parseToml(readText(doc, "settings.toml")),
        );
  } catch {
    /* Settings diagnostics already present. */
  }
  if (
    extension ||
    [...paths].some(
      (name) =>
        name.startsWith("meta/") ||
        (!["mimetype", "contents.toml", "settings.toml"].includes(name) &&
          !name.startsWith("markdown/") &&
          !name.startsWith("resources/")),
    )
  )
    issues.push({
      severity: "info",
      code: "I_EXTENSIONS_UNVERIFIED",
      message: t(
        "未知文件、字段和持久扩展按不透明数据保留；仅验证基础规则，不声称已验证扩展语义。",
      ),
    });
  const arranged = new Set(control.entries.map((e) => e.path));
  for (const name of paths)
    if (
      name.startsWith("markdown/") &&
      name.endsWith(".md") &&
      !arranged.has(name)
    )
      issues.push({
        severity: "info",
        code: "I_UNARRANGED",
        path: name,
        message: t("未编排文稿，保留文件但不加入阅读顺序。"),
      });
  return issues;
}
export function validateMdk(file: string): ValidationReport {
  try {
    const doc = load(file),
      issues = diagnostics(doc);
    return {
      valid: !issues.some((i) => i.severity === "error"),
      mode: doc.mode,
      issues,
      summary: summary(doc),
    };
  } catch (error) {
    return {
      valid: false,
      issues: [
        { severity: "error", code: "E_CONTAINER", message: String(error) },
      ],
    };
  }
}
function isRebuildableState(doc: Document, name: string) {
  if (name !== "meta/editor-state.json") return false;
  try {
    const value = JSON.parse(readText(doc, name));
    if (
      !isTable(value) ||
      value.schema_version !== 1 ||
      !Object.keys(value).every((key) =>
        [
          "schema_version",
          "cursor",
          "open_tabs",
          "folds",
          "active_path",
          "scroll",
        ].includes(key),
      )
    )
      return false;
    if (
      value.cursor !== undefined &&
      (!isTable(value.cursor) ||
        Object.keys(value.cursor).some(
          (key) => !["line", "column"].includes(key),
        ) ||
        !Object.values(value.cursor).every(
          (n) => Number.isInteger(n) && Number(n) > 0,
        ))
    )
      return false;
    if (
      value.scroll !== undefined &&
      (!isTable(value.scroll) ||
        Object.keys(value.scroll).some(
          (key) => !["top", "left"].includes(key),
        ) ||
        !Object.values(value.scroll).every(
          (n) => typeof n === "number" && Number.isFinite(n) && n >= 0,
        ))
    )
      return false;
    if (
      value.open_tabs !== undefined &&
      (!Array.isArray(value.open_tabs) ||
        !value.open_tabs.every((p) => typeof p === "string"))
    )
      return false;
    if (
      value.active_path !== undefined &&
      typeof value.active_path !== "string"
    )
      return false;
    // No folding-state schema is implemented yet: preserve it as unknown data.
    if (value.folds !== undefined) return false;
    return true;
  } catch {
    return false;
  }
}
function filterMeta(doc: Document) {
  const preferences = settings(doc).export,
    included: string[] = [],
    excluded: string[] = [],
    persistent: string[] = [];
  for (const entry of doc.zip
    .getEntries()
    .filter((e) => !e.isDirectory && e.entryName.startsWith("meta/"))) {
    const state = isRebuildableState(doc, entry.entryName);
    if (
      !preferences.include_meta ||
      (!preferences.include_editor_state && state)
    ) {
      excluded.push(entry.entryName);
      if (!state) persistent.push(entry.entryName);
    } else included.push(entry.entryName);
  }
  for (const name of excluded) doc.zip.deleteFile(name);
  if (!preferences.include_meta)
    for (const entry of doc.zip.getEntries())
      if (entry.entryName.startsWith("meta/"))
        doc.zip.deleteFile(entry.entryName);
  return { included, excluded, persistent };
}
export function planMdkExport(file: string): ExportPlan {
  const doc = load(file),
    source = diagnostics(doc),
    meta = filterMeta(doc),
    issues = [...source];
  for (const issue of diagnostics(doc))
    if (
      !issues.some(
        (old) =>
          old.code === issue.code &&
          old.path === issue.path &&
          old.message === issue.message,
      )
    )
      issues.push(issue);
  return {
    revision: doc.revision!,
    report: {
      valid: !issues.some((i) => i.severity === "error"),
      mode: doc.mode,
      issues,
      summary: summary(doc),
    },
    included_meta: meta.included,
    excluded_meta: meta.excluded,
    confirmation_required: meta.persistent.length > 0,
    preflight_report: settings(doc).export.validate_before_export,
  };
}
export function exportMdk(
  file: string,
  output: string,
  confirmedRevision = "",
) {
  const plan = planMdkExport(file);
  if (confirmedRevision && confirmedRevision !== plan.revision)
    throw new Error(t("交付预检后工程已变化，请重新预检。"));
  if (!plan.report.valid)
    throw new Error(t("请先修复严格交付检查中的错误，再交付工程。"));
  if (plan.confirmation_required && confirmedRevision !== plan.revision)
    throw new Error(
      t("本次交付将剔除持久或未知 meta 数据，必须确认具体范围：") +
        plan.excluded_meta.join("、"),
    );
  if (path.resolve(file) === path.resolve(output))
    throw new Error(t("交付必须生成独立副本，请选择其他文件名。"));
  const doc = load(file);
  if (doc.revision !== plan.revision)
    throw new Error(t("交付预检后源工程已变化，请重新预检。"));
  const preferences = settings(doc).export;
  filterMeta(doc);
  commit(output, doc, {
    overwrite: preferences.mdk.overwrite_existing,
    strict: true,
  });
  return summary(doc);
}
function applySnapshot(doc: Document, snapshot: SaveSnapshot) {
  if (!isTable(snapshot) || snapshot.revision !== doc.revision)
    throw new MdkRevisionError();
  assertEditable(doc);
  const texts = [
    ...(snapshot.text ? [snapshot.text] : []),
    ...(snapshot.texts ?? []),
  ];
  if (new Set(texts.map((text) => text.path)).size !== texts.length)
    throw new Error(t("同一文件不能在一次快照中重复提交。"));
  for (const { path: internalPath, content } of texts) {
    validatePath(internalPath);
    if (
      typeof content !== "string" ||
      /[\uD800-\uDFFF]/u.test(content) ||
      !isTextData(Buffer.from(content), internalPath)
    )
      throw new Error(t("只能写入有效的 UTF-8 文本：") + internalPath);
    validateSourceText(internalPath, content);
    if (internalPath === "settings.toml" && settingsInfo(doc).readonly)
      throw new Error(t("未知版本 settings 不可降写。"));
    if (doc.zip.getEntry(internalPath)) readText(doc, internalPath);
    put(doc, internalPath, content);
  }
  if (snapshot.positions) {
    if (texts.some((text) => text.path === "contents.toml"))
      throw new Error(t("目录源码与可视化目录存在冲突，不能相互覆盖。"));
    const control = contents(doc);
    for (const update of snapshot.positions) {
      const entry = control.entries.find((e) => e.id === update.id);
      if (!entry) throw new Error(t("目录项不存在。"));
      entry.position = update.position;
    }
    control.entries.sort((a, b) => comparePosition(a.position, b.position));
    putContents(doc, control);
  }
  if (snapshot.settings) {
    if (texts.some((text) => text.path === "settings.toml"))
      throw new Error(t("设置源码与设置表单存在冲突。"));
    if (settingsInfo(doc).readonly)
      throw new Error(t("未知版本 settings 不可降写。"));
    resolveSettings(snapshot.settings);
    let old: Table = { schema_version: 1 };
    try {
      if (doc.zip.getEntry("settings.toml"))
        old = parseToml(readText(doc, "settings.toml"));
    } catch {
      /* Explicit form repair only. */
    }
    put(
      doc,
      "settings.toml",
      stringify(merge(old, settingsChanges(old, snapshot.settings))),
    );
  }
}
export function saveMdkSnapshot(
  file: string,
  snapshot: SaveSnapshot,
): MdkProject {
  const doc = load(file);
  applySnapshot(doc, snapshot);
  commit(file, doc);
  return project(doc);
}
export function applyMdkBatch(
  file: string,
  revision: string,
  batch: {
    newEntries: { id?: string; path: string; position: string; markdown?: string; title?: string }[];
    writes: { id: string; markdown: string }[];
    positions: EntryPositionUpdate[];
  },
) {
  const doc = load(file, revision);
  assertEditable(doc);
  const control = contents(doc);
  const paths = new Set(doc.zip.getEntries().map((entry) => entry.entryName.replace(/\/$/, "")));
  const texts: NonNullable<SaveSnapshot["texts"]> = [];
  const writtenIds = new Set(batch.writes.map(({ id }) => id));
  for (const item of batch.newEntries) {
    validatePath(item.path);
    if (!item.path.startsWith("markdown/") || !item.path.endsWith(".md"))
      throw new Error(t("只能将 markdown/ 下的 .md 文稿加入目录。"));
    if (paths.has(item.path)) throw new Error(t("目标路径已存在。") + " " + item.path);
    paths.add(item.path);
    const entry = withEntryTitle({
      id: item.id ?? randomUUID(), path: item.path, position: item.position,
    }, item.title);
    control.entries.push(entry);
    if (item.markdown !== undefined || !writtenIds.has(entry.id))
      texts.push({
        path: entry.path,
        content: item.markdown ?? `# ${item.title ?? path.posix.basename(entry.path, ".md")}\n\n`,
      });
  }
  const byId = new Map(control.entries.map((entry) => [entry.id, entry]));
  for (const { id, position } of batch.positions) {
    const entry = byId.get(id);
    if (!entry) throw new Error(t("目录项不存在：") + id);
    entry.position = position;
  }
  for (const { id, markdown } of batch.writes) {
    const entry = byId.get(id);
    if (!entry) throw new Error(t("目录项不存在：") + id);
    texts.push({ path: entry.path, content: markdown });
  }
  if (batch.newEntries.length || batch.positions.length) {
    control.entries.sort((a, b) => comparePosition(a.position, b.position));
    putContents(doc, control);
  }
  applySnapshot(doc, { revision, texts });
  commit(file, doc);
  return project(doc);
}
export function copyMdkDraft(
  file: string,
  output: string,
  snapshot: SaveSnapshot,
) {
  if (!/\.mdk$/i.test(output)) throw new Error(t("副本须使用 .mdk 扩展名。"));
  const doc = load(file);
  applySnapshot(doc, { ...snapshot, revision: doc.revision! });
  commit(output, doc, { overwrite: false });
}
export function insertMdkResources(
  file: string,
  sources: InsertionSource[],
  insertion: ResourceInsertion,
): ResourceInsertionResult {
  const doc = load(file);
  assertEditable(doc);
  if (!isTable(insertion) || insertion.revision !== doc.revision)
    throw new Error(t("工程版本已变化，请重新拖入；原文和资源未修改。"));
  if (
    !insertion.text?.path.startsWith("markdown/") ||
    !insertion.text.path.endsWith(".md") ||
    typeof insertion.text.content !== "string"
  )
    throw new Error(t("只能向 Markdown 文稿插入资源。"));
  readText(doc, insertion.text.path);
  if (
    typeof insertion.marker !== "string" ||
    !/^[A-Za-z0-9]{24,100}$/.test(insertion.marker) ||
    insertion.text.content.split(insertion.marker).length !== 2
  )
    throw new Error(t("资源插入位置无效。"));
  const assets = loadInsertionAssets(sources);
  const resources: ResourceFile[] = assets.map((asset) => {
    const name = uniqueName(doc, "resources/" + asset.kind, asset.name);
    put(doc, name, asset.bytes);
    return { path: name, kind: asset.kind, bytes: asset.bytes.length };
  });
  const markdown = resources
    .map((resource, index) => {
      const target = path.posix
        .relative(path.posix.dirname(insertion.text.path), resource.path)
        .split("/")
        .map(encodeURIComponent)
        .join("/");
      const label = assets[index].name.replace(
        /[\\[\]]/g,
        (char) => "\\" + char,
      );
      return (
        (resource.kind === "image" ? "!" : "") +
        "[" +
        label +
        "](<" +
        target +
        ">)"
      );
    })
    .join("\n\n");
  const content = insertion.text.content.replace(
    insertion.marker,
    () => markdown,
  );
  applySnapshot(doc, {
    ...insertion,
    text: { path: insertion.text.path, content },
  });
  commit(file, doc);
  return { project: project(doc), content, resources };
}
export function readMdkReadingUnits(file: string) {
  const doc = load(file);
  return [...contents(doc).entries]
    .sort((a, b) => comparePosition(a.position, b.position))
    .map((entry) => {
      let markdown: string | null = null;
      try {
        if (doc.zip.getEntry(entry.path)) markdown = readText(doc, entry.path);
      } catch {
        /* Report this unit without hiding other manuscripts. */
      }
      return { ...entry, markdown };
    });
}

export function checkMdkDirectory(directory: string) {
  const control = path.join(directory, "contents.toml");
  const info = fs.lstatSync(control, { throwIfNoEntry: false });
  if (!info?.isFile())
    throw new Error(
      t("请选择解包后的 MDK 目录。缺少有效的 contents.toml 文件。"),
    );
  if (info.size > MAX_FILE) throw new Error(t("contents.toml 超过 64 MiB。"));
  validateContents(parseToml(text(fs.readFileSync(control))));
}

export function packMdk(directory: string, output: string, mode: string) {
  checkMdkDirectory(directory);
  const doc = {
    mode: normalizeMode(mode),
    zip: new AdmZip(undefined, { noSort: true }),
  };
  const walk = (dir: string) => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      if (item.isSymbolicLink()) throw new Error(t("打包目录不能含符号链接。"));
      const full = path.join(dir, item.name);
      if (item.isDirectory()) walk(full);
      else {
        const relative = path
          .relative(directory, full)
          .split(path.sep)
          .join("/");
        if (
          ["mimetype", ".mdk-mode"].includes(relative) ||
          path.resolve(full) === path.resolve(output)
        )
          continue;
        if (fs.statSync(full).size > MAX_FILE)
          throw new Error(t("文件超过 64 MiB。"));
        put(doc, relative, fs.readFileSync(full));
      }
    }
  };
  walk(directory);
  contents(doc);
  commit(output, doc, {
    overwrite: settings(doc).export.mdk.overwrite_existing,
  });
  return summary(doc);
}
export function unpackMdk(file: string, directory: string) {
  const doc = load(file),
    root = path.resolve(directory),
    entries = doc.zip.getEntries().filter((e) => e.entryName !== "mimetype");
  const all = entries.map((e) => ({
    name: e.entryName.replace(/\/$/, ""),
    directory: e.isDirectory,
  }));
  if (all.some((e) => e.name === ".mdk-mode"))
    throw new Error(
      t("包内 .mdk-mode 与解包标记冲突，请在虚拟文件管理器中处理。"),
    );
  const normalized = new Map<string, string>();
  for (const item of all) {
    const parts = item.name.split("/");
    for (let i = 1; i <= parts.length; i++) {
      const name = parts.slice(0, i).join("/"),
        key =
          process.platform === "win32"
            ? name.normalize("NFC").toLowerCase()
            : name.normalize("NFC");
      if (normalized.has(key) && normalized.get(key) !== name)
        throw new Error(t("解包名称大小写或 Unicode 归一化冲突：") + name);
      normalized.set(key, name);
      if (
        process.platform === "win32" &&
        parts.some(
          (part) =>
            /[<>"|?*]|[. ]$/.test(part) ||
            /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
        )
      )
        throw new Error(t("名称无法在 Windows 上安全表示：") + item.name);
    }
  }
  const noLinks = (target: string) => {
    let current = path.parse(target).root;
    for (const part of target
      .slice(current.length)
      .split(path.sep)
      .filter(Boolean)) {
      current = path.join(current, part);
      if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink())
        throw new Error(t("解包目标或祖先目录不能含符号链接/重解析点。"));
    }
  };
  noLinks(root);
  if (fs.existsSync(path.join(root, ".mdk-mode")))
    throw new Error(t("此目录已含有解包工程。"));
  for (const item of all) {
    const target = path.resolve(root, ...item.name.split("/"));
    if (!target.startsWith(root + path.sep))
      throw new Error(t("解包目标超出选定目录。"));
    noLinks(target);
    if (
      fs.existsSync(target) &&
      (!item.directory || !fs.statSync(target).isDirectory())
    )
      throw new Error(t("解包目标已存在：") + item.name);
    let parent = path.dirname(target);
    while (parent !== root && parent.startsWith(root + path.sep)) {
      if (fs.existsSync(parent) && !fs.statSync(parent).isDirectory())
        throw new Error(t("目标父路径不是目录。"));
      parent = path.dirname(parent);
    }
  }
  fs.mkdirSync(root, { recursive: true });
  const realRoot = fs.realpathSync(root);
  for (const entry of entries) {
    const target = path.resolve(root, ...entry.entryName.split("/"));
    noLinks(target);
    fs.mkdirSync(entry.isDirectory ? target : path.dirname(target), {
      recursive: true,
    });
    const actualParent = fs.realpathSync(
      entry.isDirectory ? target : path.dirname(target),
    );
    if (
      actualParent !== realRoot &&
      !actualParent.startsWith(realRoot + path.sep)
    )
      throw new Error(t("解包目标发生链接逃逸，已停止。"));
    if (!entry.isDirectory)
      fs.writeFileSync(target, entry.getData(), { flag: "wx" });
  }
  fs.writeFileSync(path.join(root, ".mdk-mode"), doc.mode, { flag: "wx" });
  return summary(doc);
}

export function readMdkResource(file: string, internalPath: string) {
  validatePath(internalPath);
  const entry = load(file).zip.getEntry(internalPath);
  if (!entry || entry.isDirectory) throw new Error(t("资源不存在或是目录。"));
  const bytes = entry.getData();
  checkMedia(internalPath, bytes);
  if (
    detectMediaType(bytes) === "image/svg+xml" &&
    /<\s*(?:script|foreignObject|iframe|object|embed)\b|\bon\w+\s*=|(?:href|src)\s*=\s*["']\s*(?!#)|@import|url\(\s*["']?\s*(?!#)/i.test(
      text(bytes),
    )
  )
    throw new Error(t("SVG 含活动内容或外部引用，仅提供源码或文件信息。"));
  return `data:${detectMediaType(bytes) ?? "application/octet-stream"};base64,${bytes.toString("base64")}`;
}
