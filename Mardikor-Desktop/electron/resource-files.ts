import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type AdmZip from "adm-zip";
import { t } from "../shared/i18n";
import { validatePath } from "../shared/schema";
import {
  isFixedResourceFolder,
  isResourcePath,
  resourceCategories,
} from "../shared/resources";
import { MAX_ENTRIES, MAX_FILE, MAX_TOTAL } from "./archive";
import { checkMedia, detectMediaType } from "./media";

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

export function requireResourceFolder(zip: AdmZip, folder: string) {
  resourcePath(folder);
  if (zip.getEntry(folder))
    throw new Error(t("普通文件不能作为父目录：{0}", folder));
  if (
    !isFixedResourceFolder(folder) &&
    !zip.getEntries().some((entry) => entry.entryName.startsWith(folder + "/"))
  )
    throw new Error(t("文件或目录不存在。"));
}

export function resourceNameIndex(zip: AdmZip) {
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
  zip: AdmZip,
  parent: string,
  name: string,
) {
  resourceName(name);
  requireResourceFolder(zip, parent);
  const names = resourceNameIndex(zip);
  checkDirectorySpelling(names, parent);
  const target = parent + "/" + name;
  if (names.has(nameKey(target))) throw new Error(t("目标路径已存在。"));
  zip.addFile(target + "/", Buffer.alloc(0));
}

export function importResourceFiles(
  zip: AdmZip,
  parent: string,
  paths: string[],
) {
  requireResourceFolder(zip, parent);
  if (!paths.length || paths.length > MAX_ENTRIES)
    throw new Error(t("请选择要导入的资源。"));
  const names = resourceNameIndex(zip);
  checkDirectorySpelling(names, parent);
  const existing = zip.getEntries();
  let count = existing.length;
  let size = existing.reduce((total, entry) => total + entry.header.size, 0);
  const category = parent.split("/")[1];
  function add(source: string, destination: string, info: fs.Stats) {
    if (++count > MAX_ENTRIES)
      throw new Error(t("超出实现支持范围：最多 10,000 个 ZIP 项。"));
    if (!info.isDirectory() && !info.isFile())
      throw new Error(t("资源导入仅支持普通文件和目录。"));
    const key = nameKey(destination);
    if (names.has(key))
      throw new Error(t("目标路径已存在。") + " " + destination);
    names.set(key, destination);
    if (info.isDirectory()) {
      zip.addFile(destination + "/", Buffer.alloc(0));
      for (const item of fs.readdirSync(source)) {
        resourceName(item);
        const input = path.join(source, item);
        add(input, destination + "/" + item, fs.lstatSync(input));
      }
      return;
    }
    if (info.size >= 2 ** 32)
      throw new Error(t("v1 不支持 4 GiB 及以上资源。"));
    if (info.size > MAX_FILE)
      throw new Error(t("超出实现支持范围：资源超过 64 MiB。"));
    if ((size += info.size) > MAX_TOTAL)
      throw new Error(t("超出实现支持范围：单文件 64 MiB / 总量 256 MiB。"));
    const handle = fs.openSync(source, "r");
    let bytes: Buffer;
    try {
      const current = fs.fstatSync(handle);
      if (
        !current.isFile() ||
        current.ino !== info.ino ||
        current.dev !== info.dev ||
        current.size !== info.size
      )
        throw new Error(t("导入期间源文件发生变化，请重试。"));
      bytes = Buffer.alloc(info.size);
      let offset = 0;
      while (offset < bytes.length) {
        const read = fs.readSync(
          handle,
          bytes,
          offset,
          bytes.length - offset,
          null,
        );
        if (!read) throw new Error(t("导入期间源文件发生变化，请重试。"));
        offset += read;
      }
      const after = fs.fstatSync(handle);
      if (after.size !== info.size || after.mtimeMs !== info.mtimeMs)
        throw new Error(t("导入期间源文件发生变化，请重试。"));
    } finally {
      fs.closeSync(handle);
    }
    checkMedia(destination, bytes);
    const detected = detectMediaType(bytes);
    if (
      category &&
      category !== "other" &&
      resourceCategories.some((kind) => kind === category) &&
      detected &&
      !detected.startsWith(category + "/")
    )
      throw new Error(t("资源类型与实际文件格式不一致。") + " " + destination);
    zip.addFile(destination, bytes);
  }
  for (const source of paths) {
    const info = fs.lstatSync(source);
    const basename = path.basename(source);
    resourceName(basename);
    const extension = info.isDirectory() ? "" : path.extname(basename);
    const stem = basename.slice(0, basename.length - extension.length);
    let name = parent + "/" + basename;
    for (let suffix = 2; names.has(nameKey(name)); suffix++)
      name = parent + "/" + stem + "-" + suffix + extension;
    add(source, name, info);
  }
  return count - existing.length;
}

export function selectResourceEntries(zip: AdmZip, paths: string[], resourcesOnly = true) {
  if (!Array.isArray(paths) || !paths.length || paths.length > MAX_ENTRIES)
    throw new Error(t("请选择要提取的资源。"));
  const entries = zip.getEntries();
  const exact = new Map(
    entries.map((entry) => [entry.entryName.replace(/\/$/, ""), entry]),
  );
  const folders = new Set<string>();
  const selected = new Set<AdmZip.IZipEntry>();
  for (const name of new Set(paths)) {
    if (resourcesOnly) resourcePath(name);
    else validatePath(name);
    const entry = exact.get(name);
    if (entry && !entry.isDirectory && name !== "resources")
      selected.add(entry);
    else {
      if (resourcesOnly) requireResourceFolder(zip, name);
      else if (!entry?.isDirectory && !entries.some((item) => item.entryName.startsWith(name + "/")))
        throw new Error(t("文件或目录不存在。"));
      folders.add(name);
    }
  }
  for (const entry of entries) {
    const parts = entry.entryName.replace(/\/$/, "").split("/");
    if (resourcesOnly && (parts[0] !== "resources" || parts.length < 2)) continue;
    if (parts.some((_, i) => folders.has(parts.slice(0, i + 1).join("/"))))
      selected.add(entry);
  }
  if (!selected.size) throw new Error(t("所选目录没有可提取的资源。"));
  return [...selected];
}

export function extractResourceEntries(
  entries: AdmZip.IZipEntry[],
  destination: string,
  single: boolean,
  resourcesOnly = true,
) {
  if (single) {
    const temporary = path.join(
      path.dirname(destination),
      ".mardikor-" + randomUUID() + ".tmp",
    );
    let created = false;
    try {
      const bytes = entries[0].getData();
      const descriptor = fs.openSync(temporary, "wx");
      created = true;
      try {
        fs.writeFileSync(descriptor, bytes);
      } finally {
        fs.closeSync(descriptor);
      }
      fs.copyFileSync(temporary, destination, fs.constants.COPYFILE_EXCL);
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
    const parts = entry.entryName.replace(/\/$/, "").split("/").slice(resourcesOnly ? 1 : 0);
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
  const output = fs.mkdtempSync(path.join(parent, resourcesOnly ? "Mardikor-resources-" : "Mardikor-files-"));
  let count = 0;
  try {
    for (const entry of entries) {
      const parts = entry.entryName.replace(/\/$/, "").split("/").slice(resourcesOnly ? 1 : 0);
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
        fs.writeFileSync(target, entry.getData(), { flag: "wx" });
        count++;
      }
    }
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
