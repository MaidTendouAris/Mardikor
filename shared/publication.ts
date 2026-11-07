import type { MdkSettings, ValidationReport } from "./mdk";
import { defaultSettings } from "./defaults";

export type PublicationFormat = "pdf" | "epub";
export interface PublicationSettings {
  version: number;
  metadata: {
    title: string;
    author: string;
    language: string;
    identifier: string;
    modified: string;
    publisher: string;
    description: string;
    rights: string;
    cover: string;
  };
  pdf: {
    engine: string;
    font_sha256: string;
    page_width?: number;
    page_height: number;
    landscape: boolean;
    scale: number;
    print_background: boolean;
    grayscale: boolean;
    tagged: boolean;
    outline: boolean;
    chapter_break: "none" | "page" | "right";
    include_cover: boolean;
    include_toc: boolean;
    page_ranges: string;
    page_numbers: boolean;
    first_page_number: number;
    header: string;
    footer: string;
    furniture_size: number;
  };
  epub: {
    layout: "reflowable" | "pre-paginated";
    embed_font: boolean;
    toc_in_spine: boolean;
    include_cover: boolean;
    direction: "ltr" | "rtl";
  };
}
export interface PublicationConfiguration {
  publication: PublicationSettings;
  appearance: MdkSettings["appearance"];
  colors: MdkSettings["colors"];
  layout: MdkSettings["layout"];
  book: MdkSettings["mode"]["book"];
  comic: MdkSettings["mode"]["comic"];
  render_containers: boolean;
}
export interface PublicationInfo {
  revision: string;
  mode: string;
  standalone: boolean;
  saved: boolean;
  engine: string;
  configuration: PublicationConfiguration;
  fonts: string[];
  images: string[];
}
export interface PublicationPlan {
  revision: string;
  fingerprint: string;
  format: PublicationFormat;
  report: ValidationReport;
  chapters: number;
  font: string;
}
export interface PublicationResult {
  path: string;
  bytes: number;
  sha256: string;
  pages?: number;
}
export const bundledFontPath =
  "resources/font/Mardikor-NotoSansCJKsc-Regular.otf";
export const bundledFontHash =
  "2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b";
export function publicationLabels(language: string) {
  return /^zh(?:-|$)/i.test(language)
    ? {
        toc: "目录",
        group: "分组",
        cover: "封面",
        start: "正文",
        landmarks: "导航",
      }
    : {
        toc: "Contents",
        group: "Group",
        cover: "Cover",
        start: "Start",
        landmarks: "Landmarks",
      };
}
export function defaultPublication(
  title: string,
  mode: string,
): PublicationSettings {
  return {
    version: 1,
    metadata: {
      title,
      author: "",
      language: "zh-CN",
      identifier: "",
      modified: new Date().toISOString().slice(0, 10) + "T00:00:00Z",
      publisher: "",
      description: "",
      rights: "",
      cover: "",
    },
    pdf: {
      engine: "",
      font_sha256: "",
      page_width: (210 * 96) / 25.4,
      page_height: (297 * 96) / 25.4,
      landscape: false,
      scale: 1,
      print_background: true,
      grayscale: false,
      tagged: true,
      outline: true,
      chapter_break: mode === "00" ? "none" : "page",
      include_cover: false,
      include_toc: mode === "01",
      page_ranges: "",
      page_numbers: true,
      first_page_number: 1,
      header: "",
      footer: "",
      furniture_size: 10,
    },
    epub: {
      layout: mode === "02" ? "pre-paginated" : "reflowable",
      embed_font: true,
      toc_in_spine: false,
      include_cover: true,
      direction: "ltr",
    },
  };
}
export function publicationFrom(settings: MdkSettings): unknown {
  return (
    settings.extensions?.mardikor as { publication?: unknown } | undefined
  )?.publication;
}
export function configurationFrom(
  settings: MdkSettings,
  publication: PublicationSettings,
): PublicationConfiguration {
  const defaults = defaultSettings();
  const known = <T extends object>(source: T, shape: T): T =>
    Object.fromEntries(
      Object.keys(shape).map((key) => [key, source[key as keyof T]]),
    ) as T;
  return {
    publication,
    appearance: known(settings.appearance, defaults.appearance),
    colors: known(settings.colors, defaults.colors),
    layout: known(settings.layout, defaults.layout),
    book: known(settings.mode.book, defaults.mode.book),
    comic: known(settings.mode.comic, defaults.mode.comic),
    render_containers: settings.preview.render_containers,
  };
}
export function inspectPublication(value: unknown): PublicationSettings {
  const shape = defaultPublication("", "00");
  const object = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === "object" && !Array.isArray(value);
  const visit = (
    source: unknown,
    template: Record<string, unknown>,
    prefix: string,
  ): Record<string, unknown> => {
    if (!object(source)) throw new Error(prefix + " 必须为表。");
    const result: Record<string, unknown> = {};
    for (const [key, fallback] of Object.entries(template)) {
      let current = source[key];
      const field = prefix + "." + key;
      // Original v1 configurations used layout.page_width for the paper.
      if (field === "publication.pdf.page_width" && current === undefined)
        continue;
      if (object(fallback)) result[key] = visit(current, fallback, field);
      else {
        if (typeof fallback === "number" && typeof current === "bigint")
          current = Number(current);
        if (
          typeof current !== typeof fallback ||
          (typeof current === "number" && !Number.isFinite(current))
        )
          throw new Error(field + " 的类型或取值无效。");
        if (
          typeof current === "string" &&
          (current.length > 16000 ||
            [...current].some(
              (char) =>
                (char.charCodeAt(0) < 32 && !"\t\r\n".includes(char)) ||
                char.charCodeAt(0) === 127,
            ))
        )
          throw new Error(field + " 含禁止字符或过长。");
        if (
          typeof current === "string" &&
          [...current].some((char) => {
            const point = char.codePointAt(0)!;
            return (
              (point >= 0xd800 && point <= 0xdfff) ||
              point === 0xfffe ||
              point === 0xffff
            );
          })
        )
          throw new Error(field + " 包含无效的 Unicode 字符。");
        result[key] = current;
      }
    }
    return result;
  };
  const result = visit(
    value,
    shape as unknown as Record<string, unknown>,
    "publication",
  ) as unknown as PublicationSettings;
  if (result.version !== 1)
    throw new Error("不支持此版本的导出配置，请升级应用。");
  const { pdf, epub, metadata } = result;
  if (
    !metadata.title.trim() ||
    !/^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/.test(metadata.language)
  )
    throw new Error("作品标题和有效的 BCP 47 语言标记为必填项。");
  if (
    metadata.identifier &&
    !/^[a-z][a-z0-9+.-]*:\S+$/i.test(metadata.identifier)
  )
    throw new Error("出版物标识须为 URI，例如 urn:uuid:… 或 urn:isbn:…。");
  if (
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(metadata.modified) ||
    !Number.isFinite(Date.parse(metadata.modified)) ||
    new Date(metadata.modified).toISOString().replace(".000Z", "Z") !==
      metadata.modified
  )
    throw new Error("出版日期须为有效的 UTC 时间，例如 2026-11-04T00:00:00Z。");
  if (
    (pdf.page_width !== undefined &&
      (pdf.page_width < 96 || pdf.page_width > 14400)) ||
    pdf.page_height < 96 ||
    pdf.page_height > 14400 ||
    pdf.scale < 0.25 ||
    pdf.scale > 2 ||
    pdf.furniture_size < 6 ||
    pdf.furniture_size > 36 ||
    !Number.isInteger(pdf.first_page_number) ||
    pdf.first_page_number < 1 ||
    pdf.first_page_number > 100000
  )
    throw new Error("PDF 纸张尺寸、缩放、页码或页眉字号超出支持范围。");
  if (
    !["none", "page", "right"].includes(pdf.chapter_break) ||
    !["reflowable", "pre-paginated"].includes(epub.layout) ||
    !["ltr", "rtl"].includes(epub.direction)
  )
    throw new Error("无效的分页、EPUB 布局或阅读方向。");
  if (pdf.font_sha256 && !/^[0-9a-f]{64}$/.test(pdf.font_sha256))
    throw new Error("字体 SHA-256 无效。");
  if (
    pdf.page_ranges &&
    !/^\d+(?:-\d+)?(?:,\s*\d+(?:-\d+)?)*$/.test(pdf.page_ranges)
  )
    throw new Error("页码范围格式须为 1-3,5。");
  let previous = 0;
  for (const group of pdf.page_ranges.split(",").filter(Boolean)) {
    const [start, end = start] = group.trim().split("-").map(Number);
    if (start <= previous || end < start || end > 100000)
      throw new Error("页码范围须为递增且不重叠的正整数范围。");
    previous = end;
  }
  for (const text of [pdf.header, pdf.footer])
    if (text.replace(/\{(?:title|author|page|pages)\}/g, "").match(/[{}\r\n]/))
      throw new Error(
        "页眉页脚仅支持单行文字和 {title}、{author}、{page}、{pages} 占位符。",
      );
  return result;
}
