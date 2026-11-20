import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { t } from "../shared/i18n";
import { validatePath } from "../shared/schema";
import {
  isFixedResourceFolder,
  isResourcePath,
  resourceCategories,
  resourceRoot,
} from "../shared/resources";
import { MAX_ENTRIES } from "./archive";
import {
  addedFile,
  archiveLimit,
  exactSize,
  type StoreArchive,
  type StoreEntry,
} from "./archive-io";
import { requireDiskSpace } from "./archive-write";
import { MAX_OUTLINE_DEPTH } from "../shared/mdk-v2";
import { archiveCheckpoint } from "./archive-operation";
import { classifyResource } from "./media";

type ImportItem = { name: string } & (
  { entry: StoreEntry } | { children: ImportItem[] }
);

const nameKey = (name: string) => name.normalize("NFC").toLowerCase();

export function resourcePath(name: string) {
  validatePath(name);
  if (!isResourcePath(name)) throw new Error(t("此操作仅限 resources 目录。"));
}

export function resourceName(name: string) {
  validatePath(name);
  if (
    /[/<>"|?*]|[. ]$/.test(name) ||
    /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name) ||
    /[\uD800-\uDFFF]/u.test(name)
  )
    throw new Error(t("文件名为空或包含非法字符。"));
}

export function requireResourceFolder(zip: StoreArchive, folder: string) {
  resourcePath(folder);
  if (zip.getEntry(folder))
    throw new Error(t("普通文件不能作为父目录：{0}", folder));
  if (
    !isFixedResourceFolder(folder) &&
    !zip.getEntries().some((entry) => entry.entryName.startsWith(folder + "/"))
  )
    throw new Error(t("文件或目录不存在。"));
}

export function resourceNameIndex(zip: StoreArchive) {
  const names = new Map<string, string>();
  for (const entry of zip.getEntries()) {
    const parts = entry.entryName.replace(/\/$/, "").split("/");
    for (let length = 1; length <= parts.length; length++) {
      const name = parts.slice(0, length).join("/");
      names.set(nameKey(name), name);
    }
  }
  for (const category of resourceCategories) {
    const name = "resources/" + category;
    if (!names.has(nameKey(name))) names.set(nameKey(name), name);
  }
  return names;
}

function checkDirectorySpelling(
  names: ReadonlyMap<string, string>,
  folder: string,
) {
  let name = "";
  for (const part of folder.split("/")) {
    name = name ? name + "/" + part : part;
    const stored = names.get(nameKey(name));
    if (stored && stored !== name) throw new Error(t("目标路径已存在。"));
  }
}

export function createResourceFolder(
  zip: StoreArchive,
  parent: string,
  name: string,
) {
  resourceName(name);
  requireResourceFolder(zip, parent);
  const names = resourceNameIndex(zip);
  checkDirectorySpelling(names, parent);
  const target = parent + "/" + name;
  if (names.has(nameKey(target))) throw new Error(t("目标路径已存在。"));
  zip.add(target + "/", Buffer.alloc(0));
}

export function importResourceFiles(
  zip: StoreArchive,
  parent: string,
  paths: string[],
) {
  requireResourceFolder(zip, parent);
  if (!paths.length || paths.length > MAX_ENTRIES)
    throw new Error(t("请选择要导入的资源。"));
  const names = resourceNameIndex(zip);
  const existing = zip.getEntries().length;
  const automatic = parent === resourceRoot;
  const checkedFolders = new Set<string>();
  let count = existing;
  let scanned = existing;
  function inspect(source: string, depth = 1): [string, ImportItem][] {
    archiveCheckpoint();
    if (++scanned > MAX_ENTRIES)
      archiveLimit(
        t("写入 ZIP 索引（条目数）"),
        source,
        scanned,
        MAX_ENTRIES,
        t("条目"),
      );
    if (depth > MAX_OUTLINE_DEPTH)
      throw new Error(t("目录超过实现支持的 128 层。"));
    const info = fs.lstatSync(source);
    const name = path.basename(source).normalize("NFC");
    resourceName(name);
    if (info.isFile()) {
      const entry = addedFile(name, source);
      const destination = automatic
        ? `${resourceRoot}/${classifyResource(entry)}`
        : parent;
      return [[destination, { name, entry }]];
    }
    if (!info.isDirectory())
      throw new Error(t("资源导入仅支持普通文件和目录。"));
    const groups = new Map<string, ImportItem[]>();
    for (const child of fs.readdirSync(source)) {
      for (const [destination, item] of inspect(
        path.join(source, child),
        depth + 1,
      )) {
        const items = groups.get(destination);
        if (items) items.push(item);
        else groups.set(destination, [item]);
      }
    }
    if (!groups.size)
      groups.set(automatic ? `${resourceRoot}/other` : parent, []);
    return [...groups].map(([destination, children]) => [
      destination,
      { name, children },
    ]);
  }
  function add(item: ImportItem, destination: string) {
    if (++count > MAX_ENTRIES)
      archiveLimit(
        t("写入 ZIP 索引（条目数）"),
        destination,
        count,
        MAX_ENTRIES,
        t("条目"),
      );
    const key = nameKey(destination);
    if (names.has(key))
      throw new Error(t("目标路径已存在。") + " " + destination);
    names.set(key, destination);
    if ("children" in item) {
      zip.add(destination + "/", Buffer.alloc(0));
      for (const child of item.children)
        add(child, `${destination}/${child.name}`);
    } else zip.set(item.entry.renamed(destination));
  }
  for (const source of paths) {
    for (const [folder, item] of inspect(source)) {
      if (!checkedFolders.has(folder)) {
        requireResourceFolder(zip, folder);
        checkDirectorySpelling(names, folder);
        checkedFolders.add(folder);
      }
      const extension = "children" in item ? "" : path.extname(item.name);
      const stem = item.name.slice(0, item.name.length - extension.length);
      let name = `${folder}/${item.name}`;
      for (let suffix = 2; names.has(nameKey(name)); suffix++)
        name = `${folder}/${stem}-${suffix}${extension}`;
      add(item, name);
    }
  }
  return count - existing;
}

export function selectResourceEntries(
  zip: StoreArchive,
  paths: string[],
  resourcesOnly = true,
) {
  if (!Array.isArray(paths) || !paths.length || paths.length > MAX_ENTRIES)
    throw new Error(t("请选择要提取的资源。"));
  const entries = zip.getEntries();
  const exact = new Map(
    entries.map((entry) => [entry.entryName.replace(/\/$/, ""), entry]),
  );
  const folders = new Set<string>();
  const selected = new Set<StoreEntry>();
  for (const name of new Set(paths)) {
    if (resourcesOnly) resourcePath(name);
    else validatePath(name);
    const entry = exact.get(name);
    if (entry && !entry.isDirectory && name !== "resources")
      selected.add(entry);
    else {
      if (resourcesOnly) requireResourceFolder(zip, name);
      else if (
        !entry?.isDirectory &&
        !entries.some((item) => item.entryName.startsWith(name + "/"))
      )
        throw new Error(t("文件或目录不存在。"));
      folders.add(name);
    }
  }
  for (const entry of entries) {
    const parts = entry.entryName.replace(/\/$/, "").split("/");
    if (resourcesOnly && (parts[0] !== "resources" || parts.length < 2))
      continue;
    if (parts.some((_, i) => folders.has(parts.slice(0, i + 1).join("/"))))
      selected.add(entry);
  }
  if (!selected.size) throw new Error(t("所选目录没有可提取的资源。"));
  return [...selected];
}

export function writeExtractedEntry(entry: StoreEntry, destination: string) {
  const fd = fs.openSync(destination, "wx", 0o600);
  try {
    try {
      entry.copyTo(fd);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  } catch (error) {
    fs.unlinkSync(destination);
    throw error;
  }
}

export function extractResourceEntries(
  entries: StoreEntry[],
  destination: string,
  single: boolean,
  resourcesOnly = true,
) {
  if (single) {
    requireDiskSpace(destination, entries[0].header.size, t("提取原文件"));
    const temporary = path.join(
      path.dirname(destination),
      ".mardikor-" + randomUUID() + ".tmp",
    );
    let created = false;
    try {
      writeExtractedEntry(entries[0], temporary);
      created = true;
      archiveCheckpoint(0, true);
      fs.linkSync(temporary, destination);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST")
        throw new Error(t("提取目标文件已存在，请选择其他名称。"));
      throw error;
    } finally {
      if (created) fs.unlinkSync(temporary);
    }
    return { path: destination, count: 1 };
  }
  const names = new Map<string, string>();
  for (const entry of entries) {
    const parts = entry.entryName
      .replace(/\/$/, "")
      .split("/")
      .slice(resourcesOnly ? 1 : 0);
    let prefix = "";
    for (const part of parts) {
      resourceName(part);
      prefix = prefix ? prefix + "/" + part : part;
      const key = nameKey(prefix);
      if (names.has(key) && names.get(key) !== prefix)
        throw new Error(t("解包名称大小写或 Unicode 归一化冲突：") + prefix);
      names.set(key, prefix);
    }
  }
  const parent = fs.realpathSync(destination);
  requireDiskSpace(
    path.join(parent, "output"),
    exactSize(
      entries.reduce((total, entry) => total + BigInt(entry.header.size), 0n),
    ),
    t("提取原文件"),
  );
  const output = fs.mkdtempSync(
    path.join(
      parent,
      resourcesOnly ? "Mardikor-resources-" : "Mardikor-files-",
    ),
  );
  let count = 0;
  try {
    for (const entry of entries) {
      const parts = entry.entryName
        .replace(/\/$/, "")
        .split("/")
        .slice(resourcesOnly ? 1 : 0);
      let directory = output;
      for (const part of parts.slice(
        0,
        entry.isDirectory ? parts.length : -1,
      )) {
        directory = path.join(directory, part);
        const existing = fs.lstatSync(directory, { throwIfNoEntry: false });
        if (!existing) fs.mkdirSync(directory);
        else if (!existing.isDirectory() || existing.isSymbolicLink())
          throw new Error(t("解包目标或祖先目录不能含符号链接/重解析点。"));
        if (!fs.realpathSync(directory).startsWith(output + path.sep))
          throw new Error(t("解包目标发生链接逃逸，已停止。"));
      }
      if (!entry.isDirectory) {
        const target = path.join(directory, parts.at(-1)!);
        writeExtractedEntry(entry, target);
        count++;
      }
    }
    archiveCheckpoint(0, true);
  } catch (error) {
    // Only remove the fresh staging directory this operation created.
    if (
      path.dirname(path.resolve(output)) === parent &&
      fs.lstatSync(output, { throwIfNoEntry: false })?.isDirectory() &&
      fs.realpathSync(output) === output
    )
      fs.rmSync(output, { recursive: true, force: true });
    throw error;
  }
  return { path: output, count };
}
