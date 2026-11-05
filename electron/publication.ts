import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import fontkit from "@pdf-lib/fontkit";
import Token from "markdown-it/lib/token.mjs";
import { DOMParser } from "@xmldom/xmldom";
import { createMarkdownParser } from "../shared/markdown-parser";
import { resolveReference } from "../shared/references";
import { buildOutline, type OutlineNode } from "../shared/tree";
import { isMarkdownFile } from "../shared/workspace";
import { resolveSettings, merge, type Table } from "../shared/schema";
import {
  bundledFontHash,
  bundledFontPath,
  configurationFrom,
  defaultPublication,
  inspectPublication,
  publicationFrom,
  publicationLabels,
  type PublicationConfiguration,
  type PublicationFormat,
  type PublicationInfo,
  type PublicationPlan,
  type PublicationResult,
} from "../shared/publication";
import type { MdkProject, ReadingUnit, ValidationIssue } from "../shared/mdk";
import { assertPassiveSvg, checkMedia, detectMediaType } from "./media";
import {
  openMarkdownFile,
  readMarkdownFile,
  readMarkdownResource,
} from "./markdown-file";
import {
  configureMdkPublication,
  fileRevision,
  readMdkPublication,
} from "./mdk";
import { pdfCjkAliases } from "./pdf-text";

export const sha256 = (data: string | Buffer) =>
  createHash("sha256").update(data).digest("hex");
export const escapeXml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[char]!,
  );
export interface PublicationRuntime {
  outputRevision: (file: string) => string | null;
  engine: string;
  assetDirectory: string;
  localConfiguration: (
    file: string,
    value?: PublicationConfiguration,
  ) => PublicationConfiguration | null;
  verifyImages: (images: { path: string; data: Buffer }[]) => void;
  verifyLayout: (prepared: PreparedPublication) => Promise<void>;
  pdf: (
    prepared: PreparedPublication,
  ) => Promise<{ bytes: Buffer; pages: number }>;
  epub: (prepared: PreparedPublication) => Buffer;
}
type Snapshot = {
  project: MdkProject;
  units: ReadingUnit[];
  files: Map<string, Buffer>;
};
export interface PublicationChapter {
  unit: ReadingUnit;
  file: string;
  html: string;
  title: string;
  anchors: Map<string, string>;
  headings: { id: string; title: string; level: number }[];
}
export interface PreparedPublication {
  format: PublicationFormat;
  snapshot: Snapshot;
  configuration: PublicationConfiguration;
  chapters: PublicationChapter[];
  assets: Map<string, { source: string; data: Buffer; mediaType: string }>;
  font: Buffer;
  fontType: string;
  fontFile: string;
  coverFile: string;
  navigation: string;
  fingerprint: string;
  issues: ValidationIssue[];
  width: number;
  height: number;
  fontText: string;
}
function applyConfiguration(
  project: MdkProject,
  configuration: PublicationConfiguration,
) {
  const settings = merge(project.settings as unknown as Table, {
    appearance: configuration.appearance,
    colors: configuration.colors,
    layout: configuration.layout,
    mode: { book: configuration.book, comic: configuration.comic },
    preview: { render_containers: configuration.render_containers },
    extensions: { mardikor: { publication: configuration.publication } },
  });
  project.settings = resolveSettings(settings);
}
function snapshot(file: string, runtime: PublicationRuntime): Snapshot {
  if (!isMarkdownFile(file)) return readMdkPublication(file);
  const project = openMarkdownFile(file);
  const configuration = runtime.localConfiguration(file);
  if (configuration) applyConfiguration(project, configuration);
  const name = path.basename(file);
  return {
    project,
    units: [
      {
        ...project.contents.entries[0],
        markdown: readMarkdownFile(file, name).content,
      },
    ],
    files: new Map(),
  };
}
function fontBytes(source: Snapshot, runtime: PublicationRuntime) {
  const name = source.project.settings.appearance.font_family;
  if (name === "system") {
    const bytes = fs.readFileSync(
      path.join(runtime.assetDirectory, "NotoSansCJKsc-Regular.otf"),
    );
    if (sha256(bytes) !== bundledFontHash)
      throw new Error("内置导出字体的完整性检查未通过。");
    return bytes;
  }
  if (!name.startsWith("resources/font/") || !source.files.has(name))
    throw new Error(
      "PDF 需要工程内的字体资源。请选择内置 Noto 字体，或导入字体后选择其 resources/font 路径；不使用本机字体替代。",
    );
  const bytes = source.files.get(name)!;
  checkMedia(name, bytes);
  if (
    !["font/otf", "font/ttf"].includes(detectMediaType(bytes) ?? "") ||
    bytes.subarray(0, 4).toString() === "ttcf"
  )
    throw new Error(
      "出版导出支持独立 OTF / TTF 字体，不支持字体集合或压缩字体。",
    );
  return bytes;
}
function parsedFont(data: Buffer) {
  const font = fontkit.create(data);
  if (!("hasGlyphForCodePoint" in font))
    throw new Error("字体集合不能用于固定导出。");
  // OS/2 embedding restrictions: restricted license / no subsetting / bitmap-only.
  const restriction = (
    font as unknown as {
      "OS/2"?: {
        fsType?: {
          noEmbedding?: boolean;
          noSubsetting?: boolean;
          bitmapOnly?: boolean;
        };
      };
    }
  )["OS/2"]?.fsType;
  if (
    restriction?.noEmbedding ||
    restriction?.noSubsetting ||
    restriction?.bitmapOnly
  )
    throw new Error(
      "字体的嵌入许可或子集限制不允许此导出，请换用可嵌入的字体。",
    );
  return font;
}
export function publicationInfo(
  file: string,
  runtime: PublicationRuntime,
): PublicationInfo {
  const source = snapshot(file, runtime),
    { project } = source;
  const stored = publicationFrom(project.settings);
  const publication =
    stored === undefined
      ? defaultPublication(
          path.basename(file).replace(/\.(mdk|md)$/i, ""),
          project.mode,
        )
      : inspectPublication(stored);
  return {
    revision: project.revision,
    mode: project.mode,
    standalone: isMarkdownFile(file),
    saved: stored !== undefined,
    engine: runtime.engine,
    configuration: configurationFrom(project.settings, publication),
    fonts: project.files
      .filter(
        (f) =>
          f.path.startsWith("resources/font/") && /\.(otf|ttf)$/i.test(f.path),
      )
      .map((f) => f.path),
    images: project.files
      .filter(
        (f) => /\.(png|jpe?g|svg)$/i.test(f.path) && f.kind === "resource",
      )
      .map((f) => f.path),
  };
}
export function configurePublication(
  file: string,
  value: PublicationConfiguration,
  revision: string,
  runtime: PublicationRuntime,
) {
  const source = snapshot(file, runtime);
  if (source.project.revision !== revision)
    throw new Error("工程已变化，请重新读取导出配置。");
  const previous = publicationFrom(source.project.settings);
  if (previous !== undefined) inspectPublication(previous);
  const publication = inspectPublication(value?.publication);
  const configuration = { ...value, publication };
  applyConfiguration(source.project, configuration);
  if (!["00", "01", "02"].includes(source.project.mode))
    throw new Error("未知 mode 不支持出版转换。");
  const font = fontBytes(source, runtime);
  parsedFont(font);
  publication.metadata.identifier ||= "urn:uuid:" + randomUUID();
  publication.pdf.engine = runtime.engine;
  publication.pdf.font_sha256 = sha256(font);
  if (isMarkdownFile(file)) runtime.localConfiguration(file, configuration);
  else {
    const assets = [];
    if (configuration.appearance.font_family === "system") {
      configuration.appearance = {
        ...configuration.appearance,
        font_family: bundledFontPath,
      };
      assets.push({ path: bundledFontPath, data: font });
    }
    if (sha256(font) === bundledFontHash) {
      assets.push({
        path: "resources/other/Mardikor-Noto-OFL.txt",
        data: fs.readFileSync(path.join(runtime.assetDirectory, "OFL.txt")),
      });
    }
    configureMdkPublication(
      file,
      {
        appearance: configuration.appearance,
        colors: configuration.colors,
        layout: configuration.layout,
        mode: { book: configuration.book, comic: configuration.comic },
        preview: { render_containers: configuration.render_containers },
        extensions: { mardikor: { publication } },
      },
      assets,
    );
  }
  return publicationInfo(file, runtime);
}
function slug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}_\s-]/gu, "")
    .replace(/\s/g, "-");
}
function validXmlText(text: string) {
  return [...text].every((c) => {
    const n = c.codePointAt(0)!;
    return (
      n === 9 ||
      n === 10 ||
      n === 13 ||
      (n >= 32 && n <= 0xd7ff) ||
      (n >= 0xe000 && n <= 0xfffd) ||
      (n >= 0x10000 && n <= 0x10ffff)
    );
  });
}
export function preparePublication(
  file: string,
  format: PublicationFormat,
  runtime: PublicationRuntime,
): PreparedPublication {
  if (!["pdf", "epub"].includes(format)) throw new Error("不支持的出版格式。");
  const source = snapshot(file, runtime),
    { project } = source;
  const issues = [...project.issues];
  const issue = (
    code: string,
    message: string,
    target?: string,
    severity: ValidationIssue["severity"] = "error",
  ) => issues.push({ severity, code, message, path: target });
  if (
    !["00", "01", "02"].includes(project.mode) ||
    (format === "epub" && !["01", "02"].includes(project.mode))
  )
    issue(
      "E_CONVERSION_MODE",
      "EPUB 仅支持 book / comic；default 与单 Markdown 仅支持 PDF。",
    );
  const stored = publicationFrom(project.settings);
  if (stored === undefined)
    issue(
      "E_EXPORT_UNSAVED",
      "请先保存完整导出配置，以便设置和字体随工程分发。",
      "settings.toml",
    );
  const publication =
    stored === undefined
      ? defaultPublication(path.basename(file), project.mode)
      : inspectPublication(stored);
  const configuration = configurationFrom(project.settings, publication),
    { pdf, epub, metadata } = publication;
  const labels = publicationLabels(metadata.language);
  if (!metadata.identifier)
    issue("E_IDENTIFIER", "请保存导出配置以生成稳定的出版物标识。");
  if (format === "pdf" && pdf.engine !== runtime.engine)
    issue(
      "E_PDF_ENGINE",
      "此工程固定的 PDF 渲染版本与当前应用不同。请使用相同版本，或明确保存配置采用当前引擎；不能保证跨版本生成相同 PDF。",
      "settings.toml",
    );
  if (!source.units.length)
    issue(
      "E_NO_CHAPTERS",
      "没有已编排文稿，不能导出空出版物。",
      "contents.toml",
    );
  if (
    source.units.length > 1000 ||
    source.units.reduce((n, u) => n + Buffer.byteLength(u.markdown ?? ""), 0) >
      8 * 1024 * 1024
  )
    issue(
      "E_CONVERSION_LIMIT",
      "出版转换最多支持 1,000 个目录项、8 MiB Markdown 正文。",
    );
  if (
    project.mode === "02" &&
    epub.layout !== "pre-paginated" &&
    format === "epub"
  )
    issue(
      "E_COMIC_LAYOUT",
      "漫画 EPUB 必须使用固定版式，一篇文稿对应一个展示页。",
    );
  const { layout, appearance } = project.settings;
  const width =
    pdf.landscape && format === "pdf" ? pdf.page_height : layout.page_width;
  const height =
    pdf.landscape && format === "pdf" ? layout.page_width : pdf.page_height;
  if (
    width < 96 ||
    width > 14400 ||
    height <= layout.margin_top + layout.margin_bottom + 24 ||
    width <= layout.margin_left + layout.margin_right + 24 ||
    appearance.font_size > 240 ||
    appearance.line_height > 10 ||
    appearance.paragraph_spacing > 20
  )
    issue(
      "E_RENDER_RANGE",
      "页面可用空间或字号/行距超出出版渲染范围；原设置未改写。",
    );
  if (
    format === "pdf" &&
    (pdf.header || pdf.footer || pdf.page_numbers) &&
    ((layout.margin_top < pdf.furniture_size * 2 && pdf.header) ||
      (layout.margin_bottom < pdf.furniture_size * 2 &&
        (pdf.footer || pdf.page_numbers)))
  )
    issue("E_FURNITURE_MARGIN", "页眉或页脚所在边距至少应为页眉字号的两倍。");
  const assets: PreparedPublication["assets"] = new Map(),
    resourceNames = new Map<string, string>();
  let font: Buffer = Buffer.alloc(0),
    fontType = "font/otf";
  try {
    font = fontBytes(source, runtime);
    fontType = detectMediaType(font)!;
    if (
      format === "epub" &&
      (epub.embed_font || epub.layout === "pre-paginated") &&
      sha256(font) === bundledFontHash &&
      !source.files
        .get("resources/other/Mardikor-Noto-OFL.txt")
        ?.equals(fs.readFileSync(path.join(runtime.assetDirectory, "OFL.txt")))
    )
      issue(
        "E_FONT_LICENSE",
        "内置字体的分发许可证缺失或被修改，请检查后重新保存导出配置。",
        "resources/other/Mardikor-Noto-OFL.txt",
      );
    if (pdf.font_sha256 !== sha256(font))
      issue(
        "E_FONT_CHANGED",
        "字体内容与保存的摘要不一致，请检查资源后重新保存导出配置。",
        project.settings.appearance.font_family,
      );
    parsedFont(font);
  } catch (error) {
    issue("E_FONT", String(error), project.settings.appearance.font_family);
  }
  const resource = (name: string): string => {
    if (resourceNames.has(name)) return resourceNames.get(name)!;
    try {
      let data = source.files.get(name);
      if (!data && isMarkdownFile(file))
        data = Buffer.from(
          readMarkdownResource(file, name).split(",")[1],
          "base64",
        );
      if (!data) throw new Error("资源不存在。");
      checkMedia(name, data);
      assertPassiveSvg(data);
      const type = detectMediaType(data);
      if (!["image/png", "image/jpeg", "image/svg+xml"].includes(type ?? ""))
        throw new Error(
          "出版转换当前支持 PNG、JPEG 和纯图形 SVG；请先转换其他媒体，不能静默丢弃。",
        );
      if (
        type === "image/svg+xml" &&
        /<\s*(?:text|tspan|style|animate\w*|set)\b|<!DOCTYPE|<!ENTITY|&(?:#|[A-Za-z])/i.test(
          data.toString("utf8"),
        )
      )
        throw new Error(
          "SVG 含文本、样式、动画或实体，不能保证便携排版。请转换为 PNG 或路径图形。",
        );
      if (type === "image/svg+xml") {
        const svg = new DOMParser({
          onError: (_level, message) => {
            throw new Error(message);
          },
        }).parseFromString(data.toString("utf8"), "image/svg+xml");
        const passive = new Set([
          "svg",
          "g",
          "defs",
          "symbol",
          "use",
          "path",
          "rect",
          "line",
          "polyline",
          "polygon",
          "circle",
          "ellipse",
          "linearGradient",
          "radialGradient",
          "stop",
          "clipPath",
          "mask",
          "pattern",
          "filter",
          "title",
          "desc",
        ]);
        for (const element of Array.from(svg.getElementsByTagName("*"))) {
          if (
            element.namespaceURI !== "http://www.w3.org/2000/svg" ||
            (!passive.has(element.localName!) &&
              !/^fe[A-Z][A-Za-z]+$/.test(element.localName!))
          )
            throw new Error(
              "SVG 含不支持的元素或命名空间：" + element.nodeName,
            );
        }
      }
      const target =
        "assets/image-" +
        (assets.size + 1) +
        (type === "image/png"
          ? ".png"
          : type === "image/jpeg"
            ? ".jpg"
            : ".svg");
      assets.set(target, { source: name, data, mediaType: type! });
      resourceNames.set(name, target);
      return target;
    } catch (error) {
      issue("E_CONVERSION_RESOURCE", String(error), name);
      return "";
    }
  };
  const chapters: PublicationChapter[] = [];
  const tokensByChapter: Token[][] = [];
  const renderedText: string[] = [];
  const parser = createMarkdownParser(
    project.settings.preview.render_containers,
  );
  parser.options.xhtmlOut = true;
  parser.validateLink = () => true;
  const rawParser = createMarkdownParser(
    project.settings.preview.render_containers,
    false,
  );
  rawParser.options.html = true;
  const walk = (tokens: Token[], visit: (token: Token) => void) =>
    tokens.forEach((token) => {
      visit(token);
      if (token.children) walk(token.children, visit);
    });
  source.units.forEach((unit, index) => {
    const markdown = unit.markdown ?? "";
    if (unit.markdown === null)
      issue("E_CHAPTER_MISSING", "目录项的 Markdown 文件缺失。", unit.path);
    if (!validXmlText(markdown))
      issue(
        "E_XML_CHARACTERS",
        "正文含不能写入出版文档的控制字符。",
        unit.path,
      );
    if (format === "epub")
      walk(rawParser.parse(markdown, {}), (token) => {
        if (token.type === "html_inline" || token.type === "html_block")
          issue(
            "E_EPUB_RAW_HTML",
            "原始 HTML 不能保证无损转换；请改写为 Markdown 或在源码中明确处理。",
            unit.path,
          );
      });
    const tokens = parser.parse(markdown, {}),
      anchors = new Map<string, string>(),
      headings: PublicationChapter["headings"] = [];
    walk(tokens, (token) => {
      if (["text", "code_inline", "code_block", "fence"].includes(token.type))
        renderedText.push(token.content);
    });
    const slugs = new Map<string, number>(),
      counters = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type !== "heading_open") continue;
      const token = tokens[i],
        inline = tokens[i + 1],
        level = Number(token.tag.slice(1)),
        id = "heading-" + (headings.length + 1);
      const title = parser.renderer.renderInlineAsText(
        inline.children ?? [],
        parser.options,
        {},
      );
      const base = slug(title),
        count = slugs.get(base) ?? 0;
      slugs.set(base, count + 1);
      anchors.set(base + (count ? "-" + count : ""), id);
      anchors.set("mdk-heading-" + (headings.length + 1), id);
      anchors.set(id, id);
      headings.push({ id, title, level });
      token.attrSet("id", id);
      if (
        project.mode === "01" &&
        project.settings.mode.book.chapter_numbering
      ) {
        counters[level - 1]++;
        counters.fill(0, level);
        const number =
          level === 1
            ? unit.position
            : [unit.position, ...counters.slice(1, level)].join(".");
        if (inline.children?.[0]) {
          const first = inline.children[0];
          if (first.type === "text")
            first.content = number + " " + first.content;
          else
            inline.children.unshift(
              Object.assign(new Token("text", "", 0), {
                content: number + " ",
              }),
            );
        }
      }
    }
    chapters.push({
      unit,
      file: "chapter-" + String(index + 1).padStart(4, "0") + ".xhtml",
      html: "",
      title: headings[0]?.title || path.posix.basename(unit.path, ".md"),
      anchors,
      headings,
    });
    tokensByChapter.push(tokens);
  });
  const destination = (
    chapter: PublicationChapter,
    url: string,
    media: boolean,
  ) => {
    const target = resolveReference(chapter.unit.path, url, media);
    if (target.kind === "unsafe") {
      issue("E_CONVERSION_URL", target.message, chapter.unit.path);
      return "";
    }
    if (target.kind === "external") {
      if (media) {
        issue(
          "E_REMOTE_MEDIA",
          "展示资源必须在工程内，转换不访问网络。",
          chapter.unit.path,
        );
        return "";
      }
      return target.url;
    }
    if (target.suffix.startsWith("?")) {
      issue("E_LINK_QUERY", "内部引用不能带查询参数。", chapter.unit.path);
      return "";
    }
    if (media) {
      if (target.suffix)
        issue(
          "E_IMAGE_FRAGMENT",
          "图片引用不能带片段或查询参数。",
          chapter.unit.path,
        );
      return resource(target.path);
    }
    const referenced =
      target.path === chapter.unit.path
        ? chapter
        : chapters.find((c) => c.unit.path === target.path);
    if (!referenced) {
      issue(
        "E_LINK_NOT_EXPORTED",
        "内部超链接指向未编排文稿或附件，无法在出版物中保留：" + url,
        chapter.unit.path,
      );
      return "";
    }
    let fragment = "";
    if (target.suffix) {
      try {
        const key = decodeURIComponent(target.suffix.slice(1)),
          id = referenced.anchors.get(key);
        if (!id) throw new Error("找不到标题锚点：" + url);
        fragment = "#" + id;
      } catch (error) {
        issue("E_ANCHOR_MISSING", String(error), chapter.unit.path);
      }
    }
    return referenced.file + fragment;
  };
  parser.renderer.rules.image = (tokens, index, options) => {
    const token = tokens[index],
      alt = parser.renderer.renderInlineAsText(
        token.children ?? [],
        options,
        {},
      ),
      src = destination(
        chapters[renderIndex],
        token.attrGet("src") ?? "",
        true,
      );
    if (!alt.trim())
      issue(
        "W_IMAGE_ALT",
        "图片缺少替代文字，建议补充后再分发。",
        chapters[renderIndex].unit.path,
        "warning",
      );
    return `<img src="${escapeXml(src)}" alt="${escapeXml(alt)}" />`;
  };
  const renderLink = parser.renderer.rules.link_open;
  parser.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
    const token = tokens[index];
    token.attrSet(
      "href",
      destination(chapters[renderIndex], token.attrGet("href") ?? "", false),
    );
    return renderLink
      ? renderLink(tokens, index, options, env, renderer)
      : renderer.renderToken(tokens, index, options);
  };
  let renderIndex = 0;
  chapters.forEach((chapter, index) => {
    renderIndex = index;
    chapter.html = parser.renderer
      .render(tokensByChapter[index], parser.options, {})
      .replace(
        /<input\b([^>]*)\/?\s*>/g,
        (_match, attributes: string) =>
          `<span class="task-marker">${attributes.includes("checked=") ? "[x]" : "[ ]"}</span>`,
      );
  });
  const coverFile =
    metadata.cover &&
    (format === "pdf" ? pdf.include_cover : epub.include_cover)
      ? resource(metadata.cover)
      : "";
  if (
    (format === "pdf" ? pdf.include_cover : epub.include_cover) &&
    metadata.cover &&
    !coverFile
  )
    issue("E_COVER", "所选封面不可转换。", metadata.cover);
  const headingItems = (chapter: PublicationChapter) => {
    type Node = {
      heading: PublicationChapter["headings"][number];
      children: Node[];
    };
    const roots: Node[] = [],
      stack: Node[] = [];
    for (const [index, heading] of chapter.headings.entries()) {
      if (
        heading.level > configuration.book.toc_depth ||
        (index === 0 && heading.level === 1)
      )
        continue;
      while (stack.length && stack.at(-1)!.heading.level >= heading.level)
        stack.pop();
      const node = { heading, children: [] };
      (stack.at(-1)?.children ?? roots).push(node);
      stack.push(node);
    }
    const render = (nodes: Node[]): string =>
      nodes
        .map(
          (node) =>
            `<li><a href="${chapter.file}#${node.heading.id}">${escapeXml(node.heading.title)}</a>${node.children.length ? "<ol>" + render(node.children) + "</ol>" : ""}</li>`,
        )
        .join("");
    return render(roots);
  };
  const list = (nodes: OutlineNode[]): string =>
    "<ol>" +
    nodes
      .map((node) => {
        const chapter = chapters.find((c) => c.unit.id === node.entry?.id);
        const label = chapter
          ? `<a href="${chapter.file}">${escapeXml((project.mode === "01" && configuration.book.chapter_numbering ? node.position + " " : "") + chapter.title)}</a>`
          : `<span>${escapeXml(labels.group + " " + node.position)}</span>`;
        const headings = chapter ? headingItems(chapter) : "";
        return `<li>${label}${headings || node.children.length ? "<ol>" + headings + (node.children.length ? list(node.children).slice(4, -5) : "") + "</ol>" : ""}</li>`;
      })
      .join("") +
    "</ol>";
  const navigation = list(buildOutline(source.units));
  const furniture = (pdf.header + pdf.footer)
    .replace(/\{title\}/g, metadata.title)
    .replace(/\{author\}/g, metadata.author);
  const navigationText =
    format === "epub" || pdf.include_toc ? Object.values(labels).join("") : "";
  const markerText = tokensByChapter.some((tokens) =>
    tokens.some((token) => token.type === "bullet_list_open"),
  )
    ? "•[x]"
    : "";
  const fontText =
    renderedText.join("") +
    furniture +
    navigationText +
    markerText +
    "0123456789 /";
  if (font.length) {
    try {
      const face = parsedFont(font);
      const missing = [
        ...new Set(
          [...fontText].filter((c) => {
            const point = c.codePointAt(0)!;
            const formatting =
              (point >= 0x200b && point <= 0x200f) ||
              (point >= 0x202a && point <= 0x202e) ||
              (point >= 0x2060 && point <= 0x206f) ||
              (point >= 0xfe00 && point <= 0xfe0f) ||
              point === 0xfeff;
            return (
              point >= 32 && !formatting && !face.hasGlyphForCodePoint(point)
            );
          }),
        ),
      ];
      if (
        missing.length &&
        (format === "pdf" || epub.embed_font || epub.layout === "pre-paginated")
      )
        issue(
          "E_FONT_GLYPHS",
          "固定字体缺少字形：" +
            missing
              .slice(0, 24)
              .map(
                (c) => c + " U+" + c.codePointAt(0)!.toString(16).toUpperCase(),
              )
              .join("、") +
            "。请换用覆盖这些字符的字体，不能回退到本机字体。",
          project.settings.appearance.font_family,
        );
      if (format === "pdf") pdfCjkAliases(font, fontText);
    } catch (error) {
      issue("E_FONT_DECODE", String(error));
    }
  }
  try {
    runtime.verifyImages(
      [...assets.values()]
        .filter((a) => a.mediaType !== "image/svg+xml")
        .map((a) => ({ path: a.source, data: a.data })),
    );
  } catch (error) {
    issue("E_IMAGE_DECODE", String(error));
  }
  if (format === "epub" && !epub.embed_font)
    issue(
      "W_READER_FONT",
      "EPUB 未嵌入字体，阅读器可能使用自己的字体和排版。",
      undefined,
      "warning",
    );
  const fingerprint = sha256(
    JSON.stringify({
      revision: project.revision,
      configuration,
      resources: [...assets].map(([name, value]) => [name, sha256(value.data)]),
      font: sha256(font),
      engine: runtime.engine,
    }),
  );
  return {
    format,
    snapshot: source,
    configuration,
    chapters,
    assets,
    font,
    fontType,
    fontFile: "assets/body-font." + (fontType === "font/ttf" ? "ttf" : "otf"),
    coverFile,
    navigation,
    fingerprint,
    issues,
    width,
    height,
    fontText,
  };
}
export async function planPublication(
  file: string,
  format: PublicationFormat,
  runtime: PublicationRuntime,
): Promise<PublicationPlan> {
  const prepared = preparePublication(file, format, runtime);
  if (!prepared.issues.some((i) => i.severity === "error")) {
    try {
      await runtime.verifyLayout(prepared);
    } catch (error) {
      prepared.issues.push({
        severity: "error",
        code: "E_PUBLICATION_LAYOUT",
        message: String(error),
      });
    }
  }
  return {
    revision: prepared.snapshot.project.revision,
    fingerprint: prepared.fingerprint,
    format,
    report: {
      valid: !prepared.issues.some((i) => i.severity === "error"),
      mode: prepared.snapshot.project.mode,
      issues: prepared.issues,
      summary: {
        mode: prepared.snapshot.project.mode,
        entries: prepared.chapters.length,
        files: prepared.snapshot.project.files.length,
        resources: prepared.assets.size,
      },
    },
    chapters: prepared.chapters.length,
    font: prepared.snapshot.project.settings.appearance.font_family,
  };
}
export async function exportPublication(
  file: string,
  output: string,
  format: PublicationFormat,
  fingerprint: string,
  runtime: PublicationRuntime,
): Promise<PublicationResult> {
  if (
    path.extname(output).toLowerCase() !== "." + format ||
    path.resolve(output).toLowerCase() === path.resolve(file).toLowerCase()
  )
    throw new Error("请选择对应格式的新输出路径，不能覆盖源工程。");
  const previous = runtime.outputRevision(output);
  if ((fs.existsSync(output) ? fileRevision(output) : null) !== previous)
    throw new Error("输出路径在确认后发生变化，请重新选择文件，未覆盖。");
  const prepared = preparePublication(file, format, runtime);
  if (prepared.fingerprint !== fingerprint)
    throw new Error("工程、资源或配置在预检后已变化，请重新严格校验。");
  if (prepared.issues.some((i) => i.severity === "error"))
    throw new Error(
      prepared.issues
        .filter((i) => i.severity === "error")
        .map((i) => i.message)
        .join("\n"),
    );
  await runtime.verifyLayout(prepared);
  const result =
    format === "pdf"
      ? await runtime.pdf(prepared)
      : { bytes: runtime.epub(prepared), pages: undefined };
  if (result.bytes.length > 256 * 1024 * 1024)
    throw new Error("导出结果超过 256 MiB，未写入文件。");
  if (fileRevision(file) !== prepared.snapshot.project.revision)
    throw new Error("生成期间源工程已改变，未发布过期导出文件。");
  const temporary = output + "." + randomUUID() + ".tmp";
  if (previous) {
    const stat = fs.lstatSync(output);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1)
      throw new Error("输出路径不能是链接或特殊文件。");
  }
  try {
    const fd = fs.openSync(temporary, "wx");
    try {
      fs.writeFileSync(fd, result.bytes);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    if (previous) {
      if (fileRevision(output) !== previous)
        throw new Error("输出文件已被外部修改，未覆盖。");
      fs.renameSync(temporary, output);
    } else {
      fs.linkSync(temporary, output);
      fs.unlinkSync(temporary);
    }
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  return {
    path: output,
    bytes: result.bytes.length,
    sha256: sha256(result.bytes),
    pages: result.pages,
  };
}
