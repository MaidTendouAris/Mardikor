import AdmZip from "adm-zip";
import subsetFont from "subset-font";
import { DOMParser } from "@xmldom/xmldom";
import {
  escapeXml as x,
  sha256,
  type PreparedPublication,
} from "./publication";
import { publicationCss } from "./publication-render";
import { bundledFontHash, publicationLabels } from "../shared/publication";

const XHTML = "http://www.w3.org/1999/xhtml";
const OPF = "http://www.idpf.org/2007/opf";
function xmlDocument(source: string) {
  return new DOMParser({
    onError: (level, message) => {
      throw new Error("EPUB XML " + level + ": " + message);
    },
  }).parseFromString(source, "application/xml");
}
export function validateGeneratedEpub(bytes: Buffer) {
  if (
    bytes.readUInt32LE(0) !== 0x04034b50 ||
    bytes.readUInt16LE(8) !== 0 ||
    bytes.subarray(30, 38).toString() !== "mimetype" ||
    bytes.readUInt16LE(28) !== 0
  )
    throw new Error("EPUB mimetype 必须是无扩展字段的首个未压缩项。");
  const zip = new AdmZip(bytes),
    paths = new Set(zip.getEntries().map((e) => e.entryName));
  if (
    paths.size !== zip.getEntries().length ||
    zip.readAsText("mimetype") !== "application/epub+zip"
  )
    throw new Error("EPUB 容器存在重复文件或错误 mimetype。");
  const container = xmlDocument(zip.readAsText("META-INF/container.xml"));
  const rootfile = container
    .getElementsByTagName("rootfile")[0]
    ?.getAttribute("full-path");
  if (rootfile !== "EPUB/package.opf") throw new Error("EPUB rootfile 无效。");
  const opf = xmlDocument(zip.readAsText(rootfile)),
    manifest = Array.from(opf.getElementsByTagNameNS(OPF, "item")),
    ids = new Map<string, string>();
  if (
    opf.documentElement?.getAttribute("unique-identifier") !==
      "publication-id" ||
    !opf.getElementsByTagName("dc:title")[0]?.textContent ||
    !opf.getElementsByTagName("dc:language")[0]?.textContent ||
    !opf.getElementsByTagName("dc:identifier")[0]?.textContent
  )
    throw new Error("EPUB 必需出版元数据不完整。");
  const declared = new Set<string>();
  for (const item of manifest) {
    const id = item.getAttribute("id")!,
      href = item.getAttribute("href")!;
    if (
      !id ||
      ids.has(id) ||
      declared.has(href) ||
      !paths.has("EPUB/" + href) ||
      !item.getAttribute("media-type")
    )
      throw new Error("EPUB manifest 的 ID、资源路径或 MIME 无效。");
    ids.set(id, href);
    declared.add(href);
  }
  if (
    manifest.filter((item) =>
      item.getAttribute("properties")?.split(" ").includes("nav"),
    ).length !== 1
  )
    throw new Error("EPUB 必须且只能有一份导航文档。");
  const spine = Array.from(opf.getElementsByTagNameNS(OPF, "itemref"));
  if (
    !spine.length ||
    spine.some((item) => !ids.has(item.getAttribute("idref")!))
  )
    throw new Error("EPUB 阅读顺序无效。");
  const documents = new Map<string, ReturnType<typeof xmlDocument>>(),
    anchorIds = new Map<string, Set<string>>();
  for (const item of manifest)
    if (item.getAttribute("media-type") === "application/xhtml+xml") {
      const href = item.getAttribute("href")!,
        doc = xmlDocument(zip.readAsText("EPUB/" + href)),
        found = new Set<string>();
      if (
        doc.documentElement?.namespaceURI !== XHTML ||
        !doc.getElementsByTagNameNS(XHTML, "title")[0]?.textContent
      )
        throw new Error("EPUB XHTML 根元素或标题无效。");
      for (const element of Array.from(doc.getElementsByTagName("*"))) {
        const id = element.getAttribute("id");
        if (id && found.has(id)) throw new Error("EPUB 文档存在重复锚点。");
        if (id) found.add(id);
        if (
          ["script", "iframe", "object", "embed", "form"].includes(
            element.localName ?? "",
          )
        )
          throw new Error("EPUB 不允许脚本、嵌入活动内容或表单。");
        for (const attribute of Array.from(element.attributes))
          if (/^on/i.test(attribute.name))
            throw new Error("EPUB 不允许事件属性。");
      }
      documents.set(href, doc);
      anchorIds.set(href, found);
    }
  for (const [href, doc] of documents)
    for (const element of Array.from(doc.getElementsByTagName("*")))
      for (const name of ["src", "href"]) {
        const value = element.getAttribute(name);
        if (!value) continue;
        if (
          /^(?:https?:\/\/|mailto:)/i.test(value) &&
          element.localName === "a"
        )
          continue;
        if (/^[a-z]+:|^\/|\.\./i.test(value))
          throw new Error("EPUB 含不安全或外部展示引用。");
        const [raw, fragment] = value.split("#"),
          target = raw || href;
        if (!declared.has(target))
          throw new Error("EPUB 引用未在 manifest 声明：" + value);
        if (fragment && !anchorIds.get(target)?.has(fragment))
          throw new Error("EPUB 锚点不存在：" + value);
      }
  for (const name of paths)
    if (
      name.startsWith("EPUB/") &&
      name !== "EPUB/package.opf" &&
      !declared.has(name.slice(5))
    )
      throw new Error("EPUB 包含未声明的出版资源。");
}
export async function buildEpub(prepared: PreparedPublication) {
  const {
      configuration: c,
      snapshot: { project },
      chapters,
      coverFile,
    } = prepared,
    { metadata: m, epub } = c.publication,
    fixed = epub.layout === "pre-paginated";
  const labels = publicationLabels(m.language);
  const zip = new AdmZip(undefined, { noSort: true }),
    manifest: string[] = [],
    spine: string[] = [];
  const add = (name: string, data: string | Buffer) => {
    zip.addFile(name, typeof data === "string" ? Buffer.from(data) : data);
    const entry = zip.getEntry(name)!;
    entry.header.time = new Date("2000-01-01T00:00:00Z");
  };
  const item = (id: string, href: string, type: string, properties = "") =>
    manifest.push(
      `<item id="${id}" href="${href}" media-type="${type}"${properties ? ` properties="${properties}"` : ""}/>`,
    );
  const document = (title: string, content: string) =>
    `<?xml version="1.0" encoding="UTF-8"?><html xmlns="${XHTML}" xmlns:epub="http://www.idpf.org/2007/ops" lang="${x(m.language)}" xml:lang="${x(m.language)}"><head><title>${x(title)}</title>${fixed ? `<meta name="viewport" content="width=${prepared.width},height=${prepared.height}"/>` : ""}<link rel="stylesheet" type="text/css" href="style.css"/></head><body>${content}</body></html>`;
  add("mimetype", "application/epub+zip");
  zip.getEntry("mimetype")!.header.method = 0;
  add(
    "META-INF/container.xml",
    '<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
  );
  if ((epub.embed_font || fixed) && sha256(prepared.font) === bundledFontHash) {
    const license = prepared.snapshot.files.get(
      "resources/other/Mardikor-Noto-OFL.txt",
    );
    if (!license)
      throw new Error("内置字体的分发许可证缺失，请重新保存导出配置。");
    add("META-INF/font-license.txt", license);
  }
  if (coverFile) {
    item(
      "cover-page",
      "cover.xhtml",
      "application/xhtml+xml",
      coverFile.endsWith(".svg") ? "svg" : "",
    );
    spine.push(
      '<itemref idref="cover-page"' +
        (fixed ? ' properties="rendition:page-spread-center"' : "") +
        "/>",
    );
    add(
      "EPUB/cover.xhtml",
      document(
        m.title,
        `<section epub:type="cover" class="cover unit"><img src="${coverFile}" alt="${x(m.title)}"/></section>`,
      ),
    );
  }
  chapters.forEach((chapter, index) => {
    const id = "chapter-" + index;
    item(
      id,
      chapter.file,
      "application/xhtml+xml",
      chapter.html.includes('.svg"') ? "svg" : "",
    );
    let property = "";
    if (fixed && project.mode === "02" && c.comic.spread_mode === "double") {
      if (index === chapters.length - 1 && chapters.length % 2)
        property = "rendition:page-spread-center";
      else
        property =
          "page-spread-" +
          ((index % 2 === 0) === (c.comic.reading_direction === "rtl")
            ? "right"
            : "left");
    }
    spine.push(
      `<itemref idref="${id}"${property ? ` properties="${property}"` : ""}/>`,
    );
    add(
      "EPUB/" + chapter.file,
      document(
        chapter.title,
        `<section class="unit">${chapter.html}</section>`,
      ),
    );
  });
  item("navigation", "nav.xhtml", "application/xhtml+xml", "nav");
  if (epub.toc_in_spine)
    spine.splice(coverFile ? 1 : 0, 0, '<itemref idref="navigation"/>');
  add(
    "EPUB/nav.xhtml",
    document(
      labels.toc,
      `<nav epub:type="toc" id="toc" class="toc"><h1>${labels.toc}</h1>${prepared.navigation}</nav><nav epub:type="landmarks" hidden="hidden"><h2>${labels.landmarks}</h2><ol>${coverFile ? `<li><a epub:type="cover" href="cover.xhtml">${labels.cover}</a></li>` : ""}<li><a epub:type="bodymatter" href="${chapters[0].file}">${labels.start}</a></li></ol></nav>`,
    ),
  );
  item("stylesheet", "style.css", "text/css");
  const { layout: l } = c;
  add(
    "EPUB/style.css",
    publicationCss(prepared, fixed) +
      (fixed
        ? `html,body{width:${prepared.width}px;height:${prepared.height}px}body{padding:${l.margin_top}px ${l.margin_right}px ${l.margin_bottom}px ${l.margin_left}px}.cover{height:100%}`
        : "body{margin:1em}img{max-height:90vh}"),
  );
  if (epub.embed_font || fixed) {
    item("body-font", prepared.fontFile, prepared.fontType);
    add(
      "EPUB/" + prepared.fontFile,
      await subsetFont(prepared.font, prepared.fontText),
    );
  } else {
    // No reference to an absent font resource in the no-embedding variant.
    const entry = zip.readAsText("EPUB/style.css");
    add(
      "EPUB/style.css",
      entry
        .replace(/@font-face\{[^}]*\}/, "")
        .replace(/font-family:PublicationFont/g, "font-family:serif"),
    );
  }
  for (const [name, asset] of prepared.assets) {
    item(
      "asset-" + manifest.length,
      name,
      asset.mediaType,
      name === coverFile ? "cover-image" : "",
    );
    add("EPUB/" + name, asset.data);
  }
  const direction =
    project.mode === "02" ? c.comic.reading_direction : epub.direction;
  add(
    "EPUB/package.opf",
    `<?xml version="1.0" encoding="UTF-8"?><package xmlns="${OPF}" version="3.0" unique-identifier="publication-id" prefix="rendition: http://www.idpf.org/vocab/rendition/#"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="publication-id">${x(m.identifier)}</dc:identifier><dc:title>${x(m.title)}</dc:title><dc:language>${x(m.language)}</dc:language>${m.author ? `<dc:creator>${x(m.author)}</dc:creator>` : ""}${(["publisher", "description", "rights"] as const).map((key) => (m[key] ? `<dc:${key}>${x(m[key])}</dc:${key}>` : "")).join("")}<meta property="dcterms:modified">${x(m.modified)}</meta><meta property="rendition:layout">${epub.layout}</meta><meta property="rendition:spread">${project.mode === "02" && c.comic.spread_mode === "double" ? "both" : "none"}</meta></metadata><manifest>${manifest.join("")}</manifest><spine page-progression-direction="${direction}">${spine.join("")}</spine></package>`,
  );
  const bytes = zip.toBuffer();
  validateGeneratedEpub(bytes);
  return bytes;
}
