import fs from "node:fs";
import path from "node:path";
import { t } from "../shared/i18n";
import { containsControl, displayArchivePath } from "../shared/schema";
import { createMdkMarkdownParser } from "../shared/markdown-parser";
import {
  headingText,
  legacyHeadingAnchor,
  v2HeadingAnchors,
} from "../shared/mdk-anchors";
import { MAX_ENTRIES, MAX_FILE, MAX_TOTAL } from "./archive";
import { decodeMarkdownSource } from "./markdown-file";
import { assertPassiveSvg, checkMedia, detectMediaType } from "./media";
import { writeImportedMdk } from "./mdk";
import { rewriteConversionLinks } from "./conversion-links";

const reportPath = "markdown/conversion-report.md";
const markdownExtension = /\.(?:md|markdown)$/i;
const windows = process.platform === "win32";
const drive = /^[a-z]:[\\/]/i;
const headings = createMdkMarkdownParser(false);
headings.validateLink = () => true;

type Document = {
  source: string;
  path: string;
  content: string;
  anchors?: Map<string, string>;
};
type Attachment = { source: string; path: string; imageProblem?: string };
type Target = Document | Attachment;

function localPath(value: string) {
  return (
    !containsControl(value) &&
    !/^[\\/]{2}/.test(value) &&
    !(windows && drive.test(value) ? value.slice(2) : value).includes(":")
  );
}

function diskTarget(source: string, raw: string) {
  if (/^file:/i.test(raw)) {
    const file = /^file:\/\/(?:localhost)?(\/(?!\/).*)$/i.exec(raw)?.[1];
    if (!file || (windows && !drive.test(file.slice(1))))
      throw new Error(t("仅支持本地文件链接。"));
    raw = windows ? file.slice(1) : file;
  }
  if (/%(?:2f|5c)/i.test(raw)) throw new Error(t("引用路径或百分号编码无效。"));
  const decoded = decodeURIComponent(raw);
  if (!localPath(decoded)) throw new Error(t("仅支持本地文件链接。"));
  return path.resolve(path.dirname(source), decoded);
}

function readOrdinaryFile(file: string, allowance: number) {
  const flags =
    fs.constants.O_RDONLY |
    (fs.constants.O_NOFOLLOW ?? 0) |
    (fs.constants.O_NONBLOCK ?? 0);
  const fd = fs.openSync(file, flags);
  try {
    const before = fs.fstatSync(fd);
    if (!before.isFile()) throw new Error(t("目标不是普通文件。"));
    if (before.size > Math.min(MAX_FILE, allowance))
      throw new Error(t("超过 MDK 的单文件或工程大小限制。"));
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(
        fd,
        bytes,
        offset,
        bytes.length - offset,
        offset,
      );
      if (!count) break;
      offset += count;
    }
    const after = fs.fstatSync(fd);
    if (
      offset !== bytes.length ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs
    )
      throw new Error(t("读取期间源文件发生变化。"));
    return bytes;
  } finally {
    fs.closeSync(fd);
  }
}

function fileProblem(error: unknown) {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "ENOENT" || code === "ENOTDIR") return t("文件不存在，已跳过。");
  if (code === "EISDIR") return t("目标不是普通文件。");
  if (code) return t("无法读取目标文件（{0}）。", code);
  return error instanceof Error ? error.message : String(error);
}

function nameAllocator() {
  const names = new Set([reportPath]);
  return (directory: string, filename: string, markdown: boolean) => {
    const ext = path.extname(filename);
    const safe = (value: string, length: number) =>
      Array.from(value.normalize("NFC").replace(/[<>:"/\\|?*\p{Cc}]/gu, "_"))
        .slice(0, length)
        .join("")
        .trim()
        .replace(/[. ]+$/, "");
    let stem =
      safe(filename.slice(0, filename.length - ext.length), 52) || "file";
    if (/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(stem))
      stem = "_" + stem;
    const suffix = markdown ? ".md" : safe(ext, 12);
    let next = directory + "/" + stem + suffix;
    for (let i = 2; names.has(next.toLowerCase()); i++)
      next = directory + "/" + stem + "-" + i + suffix;
    names.add(next.toLowerCase());
    return next;
  };
}

const encodePart = (value: string) =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => "%" + char.charCodeAt(0).toString(16).toUpperCase(),
  );
const hrefBetween = (from: string, to: string) =>
  path.posix
    .relative(path.posix.dirname(from), to)
    .split("/")
    .map(encodePart)
    .join("/");

function anchorFor(document: Document, fragment: string) {
  if (!document.anchors) {
    const tokens = headings.parse(document.content, {});
    const anchors = v2HeadingAnchors(tokens);
    const aliases = new Map<string, string>(),
      legacy = legacyHeadingAnchor();
    for (const [index, anchor] of anchors)
      aliases.set(
        legacy(headingText(tokens[index + 1]?.children ?? [])),
        anchor,
      );
    let number = 0;
    for (const anchor of anchors.values()) {
      aliases.set("mdk-heading-" + ++number, anchor);
      aliases.set(anchor, anchor);
    }
    document.anchors = aliases;
  }
  try {
    return document.anchors.get(decodeURIComponent(fragment));
  } catch {
    return undefined;
  }
}

function code(value: string) {
  const visible = displayArchivePath(value).replace(
    /\p{Cc}/gu,
    (char) => "\\u" + char.charCodeAt(0).toString(16).padStart(4, "0"),
  );
  let length = 1;
  for (const run of visible.matchAll(/[\x60]+/g))
    length = Math.max(length, run[0].length + 1);
  const fence = "\x60".repeat(length);
  return fence + " " + visible + " " + fence;
}

export function convertMarkdownToMdk(source: string, output: string) {
  source = path.resolve(source);
  output = path.resolve(output);
  if (!markdownExtension.test(source) || !/\.mdk$/i.test(output))
    throw new Error(t("请选择 Markdown 源文件并保存为 .mdk。"));
  if (!localPath(source) || !localPath(output))
    throw new Error(t("转换仅支持本地文件。"));
  if (fs.existsSync(output))
    throw new Error(t("目标文件已存在，请使用新的文件名。"));

  const documents: Document[] = [];
  const resources = new Map<string, Buffer>();
  const imported = new Map<string, Target>();
  const resolved = new Map<string, Target>();
  const failures = new Map<string, string>();
  const messages = new Set<string>();
  const allocate = nameAllocator();
  const sourceRoot = path.dirname(source);
  let bytes = 0;
  const relative = (file: string) =>
    path.relative(sourceRoot, file) || path.basename(file);
  function load(file: string): Target {
    if (!localPath(file)) throw new Error(t("仅支持本地文件链接。"));
    const cached = resolved.get(file);
    if (cached) return cached;
    const failed = failures.get(file);
    if (failed) throw new Error(failed);
    try {
      const actual = fs.realpathSync.native(file);
      if (!localPath(actual)) throw new Error(t("仅支持本地文件链接。"));
      const existing = imported.get(actual);
      if (existing) {
        resolved.set(file, existing);
        return existing;
      }
      if (!fs.lstatSync(actual).isFile())
        throw new Error(t("目标不是普通文件。"));
      if (imported.size >= MAX_ENTRIES - 4)
        throw new Error(t("达到 MDK 的文件数量限制。"));
      const data = readOrdinaryFile(actual, MAX_TOTAL - bytes);
      const filename = path.basename(file);
      let target: Target;
      if (markdownExtension.test(file)) {
        const { content } = decodeMarkdownSource(data);
        const length = Buffer.byteLength(content);
        if (length > MAX_FILE || bytes + length > MAX_TOTAL)
          throw new Error(t("超过 MDK 的单文件或工程大小限制。"));
        target = {
          source: actual,
          path: allocate("markdown", filename, true),
          content,
        };
        documents.push(target);
        bytes += length;
      } else {
        const mime = detectMediaType(data);
        const category = mime?.split("/")[0] ?? "other";
        const internal = allocate("resources/" + category, filename, false);
        let imageProblem: string | undefined;
        try {
          if (category !== "image")
            throw new Error(t("文件无法验证为图像，已作为附件保留。"));
          checkMedia(internal, data);
          assertPassiveSvg(data);
        } catch (error) {
          imageProblem = fileProblem(error);
        }
        target = { source: actual, path: internal, imageProblem };
        resources.set(internal, data);
        bytes += data.length;
      }
      imported.set(actual, target);
      resolved.set(file, target);
      return target;
    } catch (error) {
      const problem = fileProblem(error);
      failures.set(file, problem);
      throw new Error(problem);
    }
  }

  load(source);
  for (const document of documents) {
    document.content = rewriteConversionLinks(
      document.content,
      (url, media) => {
        const note = (message: string) => {
          messages.add(
            "- " +
              code(relative(document.source)) +
              " → " +
              code(url) +
              " — " +
              message,
          );
        };
        if (url.length > 8192 || containsControl(url)) {
          note(t("引用路径或百分号编码无效。"));
          return { skip: true };
        }
        if (/^https?:\/\//i.test(url)) {
          if (media) note(t("外部媒体链接已保留，文件未下载。"));
          return;
        }
        if (!media && /^mailto:/i.test(url)) return;
        const hash = url.indexOf("#");
        const beforeHash = hash < 0 ? url : url.slice(0, hash);
        const queryAt = beforeHash.indexOf("?");
        const query = queryAt < 0 ? "" : beforeHash.slice(queryAt + 1);
        const raw = queryAt < 0 ? beforeHash : beforeHash.slice(0, queryAt);
        const fragment = hash < 0 ? "" : url.slice(hash + 1);
        if (!raw && !fragment && !query) return;
        let target: Target;
        try {
          target = raw ? load(diskTarget(document.source, raw)) : document;
        } catch (error) {
          note(
            error instanceof URIError
              ? t("引用路径或百分号编码无效。")
              : fileProblem(error),
          );
          return { skip: true };
        }
        if (query) note(t("已移除本地链接的查询参数，MDK v2 未定义其含义。"));
        let anchor = "";
        if (fragment) {
          if ("content" in target) {
            const matching = anchorFor(target, fragment);
            if (matching) anchor = "#" + encodePart(matching);
            else note(t("找不到对应标题锚点，链接将打开文稿开头。"));
          } else {
            note(t("已移除未受支持的附件片段。"));
          }
        }
        if (media) {
          if ("content" in target) {
            note(t("Markdown 文稿不能作为图像显示。"));
            return { skip: true };
          }
          if (target.imageProblem) note(target.imageProblem);
        }
        return {
          href:
            (anchor && document.path === target.path
              ? ""
              : hrefBetween(document.path, target.path)) + anchor,
        };
      },
    );
  }

  const title = t("Markdown 转换报告");
  const report = [
    "# " + title,
    "",
    t("入口文稿 {0}", code(path.basename(source))),
    "",
    t("已收录 {0} 篇源文稿和 {1} 个附件。", documents.length, resources.size),
    "",
    "## " + t("已收录文件"),
    "",
    ...[...imported.values()].map(
      (item) => "- " + code(relative(item.source)) + " → " + code(item.path),
    ),
    "",
    "## " + t("转换记录"),
    "",
    ...(messages.size ? messages : [t("没有发现需要记录的引用问题。")]),
    "",
  ].join("\n");
  writeImportedMdk(
    output,
    [{ path: reportPath, title, content: report }, ...documents],
    resources,
  );
}
