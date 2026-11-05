import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { defaultSettings } from "../shared/defaults";
import { containsControl, validatePath } from "../shared/schema";
import { createMarkdownParser } from "../shared/markdown-parser";
import { resolveReference } from "../shared/references";
import { isMarkdownFile } from "../shared/workspace";
import { insertionFormats } from "../shared/resources";
import { imageMarkdown, markdownDestination } from "../shared/markdown-editing";
import type {
  MdkProject,
  SaveSnapshot,
  ResourceInsertion,
  ResourceInsertionResult,
  ResourceFile,
} from "../shared/mdk";
import { checkMedia, detectMediaType, assertPassiveSvg } from "./media";
import { loadInsertionAssets } from "./insertion-assets";

const limit = 64 * 1024 * 1024;
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const parser = createMarkdownParser(false);
const digest = (data: Buffer) =>
  createHash("sha256").update(data).digest("hex");

const executable =
  /\.(?:exe|com|bat|cmd|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|hta|msi|msp|mst|scr|cpl|lnk|url|website|reg|appref-ms|application|appx|msix|jar|command|sh|desktop|appimage|scf|pif|sct|inf|chm|msc|dll)$/i;

export function resolveMarkdownLink(file: string, href: string) {
  if (!href || href.length > 8192 || containsControl(href))
    throw new Error("文件链接无效。");
  const raw = href.split(/[?#]/, 1)[0];
  const fragment = href.includes("#") ? href.slice(href.indexOf("#") + 1) : "";
  let destination: string;
  try {
    if (/^file:\/\//i.test(raw)) {
      const url = new URL(raw);
      if (url.hostname) throw new Error();
      destination = fileURLToPath(url);
    } else destination = decodeURIComponent(raw);
  } catch {
    throw new Error("文件链接的路径或百分号编码无效。");
  }
  const localPath = (value: string) => {
    const withoutDrive =
      process.platform === "win32" ? value.replace(/^[a-z]:[\\/]/i, "") : value;
    return (
      !containsControl(value) &&
      !/^[\\/]{2}/.test(value) &&
      !withoutDrive.includes(":")
    );
  };
  if (!destination || !localPath(destination))
    throw new Error("仅支持本地文件链接。");
  const target = path.resolve(path.dirname(file), destination);
  if (!localPath(target)) throw new Error("仅支持本地文件链接。");
  let actual: string;
  try {
    actual = fs.realpathSync(target);
    if (!fs.statSync(actual).isFile()) throw new Error();
  } catch {
    throw new Error(`找不到链接文件：${destination}`);
  }
  if (
    !localPath(actual) ||
    [target, actual].some((value) =>
      executable.test(value.trimEnd().replace(/\.+$/, "")),
    )
  )
    throw new Error("此链接的文件类型不支持直接打开。");
  return { path: actual, fragment };
}
function read(file: string) {
  if (!isMarkdownFile(file))
    throw new Error("单 Markdown 工程须使用 .md 扩展名。");
  const info = fs.lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink > 1)
    throw new Error("请选择普通 Markdown 文件，不支持链接文件。");
  if (info.size > limit) throw new Error("Markdown 文件超过 64 MiB。");
  const bytes = fs.readFileSync(file),
    content = decoder.decode(bytes);
  if (content.includes("\0"))
    throw new Error("Markdown 文件必须是 UTF-8 文本。");
  return { content, revision: digest(bytes) };
}
function localFile(file: string, relative: string) {
  validatePath(relative);
  const root = fs.realpathSync(path.dirname(path.resolve(file)));
  const target = path.join(root, ...relative.split("/"));
  let current = root;
  for (const part of relative.split("/")) {
    current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink())
      throw new Error("不支持跨目录链接资源。");
  }
  return target;
}
function write(file: string, content: string, revision?: string) {
  if (
    typeof content !== "string" ||
    content.includes("\0") ||
    Buffer.byteLength(content) > limit
  )
    throw new Error("Markdown 内容无效或超过 64 MiB。");
  const temporary = file + "." + randomUUID() + ".tmp";
  try {
    const fd = fs.openSync(
      temporary,
      "wx",
      revision ? fs.statSync(file).mode : 0o666,
    );
    try {
      fs.writeFileSync(fd, content, "utf8");
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    if (revision && read(file).revision !== revision)
      throw new Error("磁盘 Markdown 已被其他进程修改，未覆盖文件。");
    if (revision) fs.renameSync(temporary, file);
    else {
      fs.linkSync(temporary, file);
      fs.unlinkSync(temporary);
    }
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}
export function openMarkdownFile(file: string): MdkProject {
  const { content, revision } = read(file),
    name = path.basename(file);
  const files: MdkProject["files"] = [
    {
      path: name,
      kind: "markdown",
      is_text: true,
      bytes: Buffer.byteLength(content),
    },
  ];
  const seen = new Set([name]);
  const visit = (tokens: ReturnType<typeof parser.parse>) => {
    for (const token of tokens) {
      const url =
        token.type === "image"
          ? token.attrGet("src")
          : token.type === "link_open"
            ? token.attrGet("href")
            : null;
      if (url) {
        const target = resolveReference(name, url, token.type === "image");
        if (
          target.kind === "local" &&
          !seen.has(target.path) &&
          Object.hasOwn(
            insertionFormats,
            path.extname(target.path).slice(1).toLowerCase(),
          )
        ) {
          seen.add(target.path);
          try {
            const info = fs.statSync(localFile(file, target.path));
            if (info.isFile())
              files.push({
                path: target.path,
                kind: "resource",
                bytes: info.size,
                is_text: false,
              });
          } catch {
            /* Missing resources remain references in the document. */
          }
        }
      }
      if (token.children) visit(token.children);
    }
  };
  visit(parser.parse(content, {}));
  const settings = defaultSettings();
  settings.preview.render_containers = false;
  return {
    format: "markdown",
    mode: "00",
    revision,
    contents: {
      schema_version: 1,
      entries: [{ id: "markdown-file", path: name, position: "1" }],
    },
    settings,
    files,
    issues: [],
    settings_readonly: true,
    readonly: false,
  };
}
export function createMarkdownFile(file: string) {
  if (!isMarkdownFile(file))
    throw new Error("单 Markdown 工程须使用 .md 扩展名。");
  write(file, "");
  return openMarkdownFile(file);
}
export function readMarkdownFile(file: string, internalPath: string) {
  if (internalPath !== path.basename(file))
    throw new Error("单 Markdown 模式仅编辑当前 .md 文件。");
  return { path: internalPath, content: read(file).content };
}
export function saveMarkdownSnapshot(file: string, snapshot: SaveSnapshot) {
  const current = read(file);
  if (!snapshot || snapshot.revision !== current.revision)
    throw new Error("磁盘 Markdown 已被其他进程修改，未覆盖文件。");
  if (snapshot.settings !== undefined || snapshot.positions !== undefined)
    throw new Error("单 Markdown 工程没有 TOML 设置或文稿编排。");
  const texts = [
    ...(snapshot.text ? [snapshot.text] : []),
    ...(snapshot.texts ?? []),
  ];
  if (texts.length > 1) throw new Error("单 Markdown 工程只能保存当前文件。");
  if (texts.length) {
    if (texts[0].path !== path.basename(file))
      throw new Error("不能修改单 Markdown 工程以外的文件。");
    write(file, texts[0].content, current.revision);
  }
  return openMarkdownFile(file);
}
export function readMarkdownResource(file: string, relative: string) {
  const target = localFile(file, relative),
    info = fs.statSync(target);
  if (!info.isFile() || info.size > limit)
    throw new Error("资源无效或超过 64 MiB。");
  const bytes = fs.readFileSync(target);
  checkMedia(relative, bytes);
  const mime = detectMediaType(bytes);
  if (
    !mime ||
    !(
      mime.startsWith("image/") ||
      mime.startsWith("audio/") ||
      mime.startsWith("video/")
    )
  )
    throw new Error("此资源不支持直接预览。");
  if (mime === "image/svg+xml") assertPassiveSvg(bytes);
  return `data:${mime};base64,${bytes.toString("base64")}`;
}
export function insertMarkdownResources(
  file: string,
  sources: string[],
  insertion: ResourceInsertion,
): ResourceInsertionResult {
  const current = read(file);
  if (insertion?.revision !== current.revision)
    throw new Error("工程版本已变化，请重新插入。");
  if (
    insertion.text?.path !== path.basename(file) ||
    typeof insertion.text?.content !== "string" ||
    typeof insertion.marker !== "string" ||
    !/^[A-Za-z0-9]{24,100}$/.test(insertion.marker) ||
    insertion.text.content.split(insertion.marker).length !== 2
  )
    throw new Error("资源插入位置无效。");
  if (
    insertion.settings !== undefined ||
    insertion.positions !== undefined ||
    insertion.texts?.length
  )
    throw new Error("单 Markdown 工程只能修改当前文件。");
  const assets = loadInsertionAssets(sources),
    published: string[] = [],
    directories: string[] = [];
  const resources: ResourceFile[] = [];
  try {
    for (const asset of assets) {
      const directory = "resources/" + asset.kind;
      const suffix = path.extname(asset.name),
        stem = asset.name.slice(0, asset.name.length - suffix.length);
      let relative = directory + "/" + asset.name,
        n = 2;
      while (
        fs.existsSync(localFile(file, relative)) ||
        resources.some((r) => r.path === relative)
      )
        relative = directory + "/" + stem + "-" + n++ + suffix;
      const target = localFile(file, relative);
      for (const part of ["resources", directory]) {
        const folder = localFile(file, part);
        if (!fs.existsSync(folder)) {
          fs.mkdirSync(folder);
          directories.push(folder);
        }
      }
      const fd = fs.openSync(target, "wx");
      published.push(target);
      try {
        fs.writeFileSync(fd, asset.bytes);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      resources.push({
        path: relative,
        kind: asset.kind,
        bytes: asset.bytes.length,
      });
    }
    const markdown = resources
      .map((resource, index) => {
        const url = resource.path.split("/").map(encodeURIComponent).join("/");
        return resource.kind === "image"
          ? imageMarkdown(url, assets[index].name)
          : "[" +
              assets[index].name.replace(/[\\[\]]/g, (c) => "\\" + c) +
              "](" +
              markdownDestination(url) +
              ")";
      })
      .join("\n\n");
    const content = insertion.text.content.replace(
      insertion.marker,
      () => markdown,
    );
    const project = saveMarkdownSnapshot(file, {
      revision: current.revision,
      text: { path: path.basename(file), content },
    });
    return { project, content, resources };
  } catch (error) {
    for (const target of published.reverse()) fs.unlinkSync(target);
    for (const directory of directories.reverse()) fs.rmdirSync(directory);
    throw error;
  }
}
