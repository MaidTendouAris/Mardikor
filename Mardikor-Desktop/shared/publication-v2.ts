import { t } from "./i18n";
import type { ValidationIssue } from "./mdk";
import { isTable, merge, type Table } from "./schema";
import { inspectV2Settings, readSystemFontSetting, setSystemFontSetting } from "./settings-v2";
import { systemFontName } from "./fonts";
import { settingsFields } from "./settings-v2-fields";
import { validFeatureToken } from "./mdk-v2";
import {
  defaultPublication,
  type EpubPresetOptions,
  type PdfPresetOptions,
  type PublicationFormat,
  type PublicationPresetInfo,
  type PublicationSettings,
} from "./publication";

export interface V2Preset {
  id: string;
  name: string;
  format: PublicationFormat;
  raw: Table;
  issues: ValidationIssue[];
}

export function newV2Preset(id: string, format: PublicationFormat, mode: string): Table {
  const layout = mode === "02" ? "fixed" : format === "pdf" ? "flow" : "reflowable";
  return { id, format, [format]: { layout } };
}

export function publicationPresetInfo(preset: V2Preset, settings: Table, mode: string): PublicationPresetInfo {
  const { id, name, format } = preset;
  const raw = preset.raw[format];
  const options = isTable(raw) ? raw : {};
  const resolved = inspectV2Settings(publicationStyle(settings, preset), mode).settings;
  const font = resolved.appearance.font_family;
  const body = preset.raw.body;
  const inheritsFont = !readSystemFontSetting(preset.raw) &&
    (!isTable(body) || (body.font === undefined && body.font_family === undefined));
  const number = (key: string, fallback: number) => {
    const value = options[key];
    return (typeof value === "number" || typeof value === "bigint") && Number.isFinite(Number(value))
      ? Number(value) : fallback;
  };
  const fixed = options.layout === "fixed";
  if (format === "pdf") {
    const pdf: PdfPresetOptions = {
      layout: fixed ? "fixed" : "flow",
      page_width: number("page_width", 210),
      page_height: number("page_height", 297),
      margin_top: number("margin_top", 20),
      margin_bottom: number("margin_bottom", 20),
      margin_left: number("margin_left", 20),
      margin_right: number("margin_right", 20),
      include_cover: options.include_cover === true,
      include_toc: options.include_toc === true,
      chapter_break: options.chapter_break === "page" ? "page" : "none",
    };
    return { id, name, format, options: pdf, font, inheritsFont };
  }
  const epub: EpubPresetOptions = {
    layout: fixed ? "fixed" : "reflowable",
    direction: (options.direction ?? resolved.mode.comic.reading_direction) === "rtl" ? "rtl" : "ltr",
    spread: (options.spread ?? resolved.mode.comic.spread_mode) === "double" ? "double" : "single",
    first_single: typeof options.first_single === "boolean" ? options.first_single : Boolean(resolved.v2?.firstSingle),
    page_width: number("page_width", 800),
    page_height: number("page_height", 1200),
    include_cover: options.include_cover === true,
    toc_in_spine: options.toc_in_spine === true,
    embed_font: typeof options.embed_font === "boolean" ? options.embed_font : fixed || !!systemFontName(font),
  };
  return { id, name, format, options: epub, font, inheritsFont, automaticFontEmbedding: typeof options.embed_font !== "boolean" };
}
const styleSections = [
  "body",
  "paragraph",
  "headings",
  "links",
  "inline_code",
  "code",
  "quote",
  "lists",
  "tasks",
  "tables",
  "images",
  "thematic_break",
  "reading",
];
const fieldRule = (key: string) =>
  settingsFields[
    key.replace(/^headings\.h[1-6]\.(?!size_scale$)/, "headings.")
  ];
const allowed = (value: unknown, ...variants: string[]) =>
  typeof value === "string" && variants.includes(value);

export function inspectV2Publication(
  raw: Table,
  settings: Table,
  mode: string,
) {
  const presets: V2Preset[] = [],
    issues: ValidationIssue[] = [];
  const id = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}(?![\s\S])/;
  const ids = new Set<string>();
  function issue(
    target: ValidationIssue[],
    field: string,
    message: string,
    unsupported = false,
  ) {
    target.push({
      scope: "publication",
      status: unsupported ? "unverified" : "fail",
      code: unsupported
        ? "mdk.capability.unsupported"
        : "mdk.publication.invalid",
      severity: "error",
      path: "publication.toml",
      field,
      message,
    });
  }
  if (raw.extensions !== undefined && !isTable(raw.extensions))
    issue(issues, "extensions", t("extensions 必须为表。"));
  const values = raw.presets ?? [];
  if (!Array.isArray(values))
    issue(issues, "presets", t("出版预设必须为表数组。"));
  else
    for (const [index, value] of values.entries()) {
      const field = "presets." + index;
      if (
        !isTable(value) ||
        typeof value.id !== "string" ||
        !id.test(value.id)
      ) {
        issue(issues, field + ".id", t("出版预设 ID 无效。"));
        continue;
      }
      if (ids.has(value.id)) {
        issue(issues, "presets", t("出版预设 ID 重复。"));
        continue;
      }
      ids.add(value.id);
      if (value.format !== "pdf" && value.format !== "epub") {
        issue(issues, field + ".format", t("出版预设格式必须是 pdf 或 epub。"));
        continue;
      }
      const preset: V2Preset = {
        id: value.id,
        name: typeof value.name === "string" ? value.name : value.id,
        format: value.format,
        raw: value,
        issues: [],
      };
      presets.push(preset);
      const invalid = (relative: string, reason: string) =>
        issue(preset.issues, field + "." + relative, reason);
      if (
        value.name !== undefined &&
        (typeof value.name !== "string" || !value.name.trim())
      )
        invalid("name", t("出版预设名称无效。"));
      if (value.requires !== undefined) {
        if (
          !Array.isArray(value.requires) ||
          !value.requires.every(validFeatureToken) ||
          new Set(value.requires.map((token) => token.split("@")[0])).size !==
            value.requires.length
        )
          invalid("requires", t("无效的出版能力声明。"));
        else if (value.requires.length)
          issue(
            preset.issues,
            field + ".requires",
            t("此预设要求未支持的出版能力：{0}", value.requires.join(", ")),
            true,
          );
      }
      const options = value[value.format];
      if (value[value.format === "pdf" ? "epub" : "pdf"] !== undefined)
        invalid(value.format, t("预设不能包含其他输出格式的设置表。"));
      if (!isTable(options)) {
        invalid(value.format, t("所选格式缺少设置表。"));
        continue;
      }
      const pdf = value.format === "pdf";
      if (!allowed(options.layout, pdf ? "flow" : "reflowable", "fixed"))
        invalid(value.format + ".layout", t("预设必须指定合法的版式。"));
      for (const key of pdf
        ? ["include_cover", "include_toc"]
        : ["include_cover", "toc_in_spine", "embed_font", "first_single"])
        if (options[key] !== undefined && typeof options[key] !== "boolean")
          invalid(value.format + "." + key, t("预设开关必须为布尔值。"));
      const sides = ["left", "right", "top", "bottom"];
      const fields = [
        "page_width",
        "page_height",
        ...(pdf ? sides.map((side) => "margin_" + side) : []),
      ];
      for (const key of fields) {
        const v = options[key];
        if (
          v !== undefined &&
          (!(typeof v === "number" || typeof v === "bigint") ||
            !Number.isFinite(Number(v)) ||
            Number(v) < (key.startsWith("margin_") ? 0 : Number.MIN_VALUE))
        )
          invalid(value.format + "." + key, t("出版尺寸无效。"));
      }
      if (pdf) {
        for (const [one, two, size] of [
          ["left", "right", "width"],
          ["top", "bottom", "height"],
        ])
          if (
            Number(options["margin_" + one] ?? 20) +
              Number(options["margin_" + two] ?? 20) >=
            Number(options["page_" + size] ?? (size === "width" ? 210 : 297))
          )
            invalid("pdf.page_" + size, t("边距总和必须小于纸张尺寸。"));
        if (
          options.chapter_break !== undefined &&
          (options.layout !== "flow" ||
            !allowed(options.chapter_break, "none", "page"))
        )
          invalid("pdf.chapter_break", t("章节换页只适用于流式 PDF。"));
      } else {
        if (
          options.direction !== undefined &&
          !allowed(options.direction, "ltr", "rtl")
        )
          invalid("epub.direction", t("无效的 EPUB 阅读方向。"));
        if (
          options.spread !== undefined &&
          !allowed(options.spread, "single", "double")
        )
          invalid("epub.spread", t("无效的 EPUB 双页设置。"));
        if (
          options.layout === "reflowable" &&
          ["spread", "first_single", "page_width", "page_height"].some(
            (key) => options[key] !== undefined,
          )
        )
          invalid("epub", t("流式 EPUB 不适用固定页面尺寸与配对选项。"));
      }
      function checkOverrides(prefix: string, values: Table) {
        for (const [name, property] of Object.entries(values)) {
          const key = prefix + "." + name;
          const rule = fieldRule(key);
          if (rule && rule[1] !== "S")
            invalid(key, t("出版预设只允许覆盖正文共享样式。"));
          else if (
            isTable(property) &&
            (/^headings\.h[1-6]$/.test(key) || key === "code.palette")
          )
            checkOverrides(key, property);
        }
      }
      for (const key of [
        "preview",
        "toc",
        "numbering",
        "document_title",
        "font_sets",
      ])
        if (value[key] !== undefined)
          invalid(key, t("出版预设只允许覆盖正文共享样式。"));
      for (const key of styleSections) {
        const override = value[key];
        if (override === undefined) continue;
        if (isTable(override)) checkOverrides(key, override);
        else invalid(key, t("出版预设只允许覆盖正文共享样式。"));
      }
      if (value.extensions !== undefined && !isTable(value.extensions))
        invalid("extensions", t("extensions 必须为表。"));
      const styled = inspectV2Settings(
        publicationStyle(settings, preset),
        mode,
      );
      for (const problem of styled.problems.filter(
        ({ field }) =>
          styleSections.includes(field) ||
          fieldRule(field)?.[1] === "S" ||
          (!pdf &&
            ((options.direction === undefined &&
              field === "reading.direction") ||
              (options.layout === "fixed" &&
                ((options.spread === undefined && field === "reading.spread") ||
                  (options.first_single === undefined &&
                    field === "reading.first_single"))))),
      ))
        invalid(problem.field, problem.message);
      for (const key of styled.unsupported) {
        const rule = fieldRule(key);
        if (
          rule?.[1] === "S" ||
          (key === "body.font" && styled.settings.v2?.values[key] !== "generic")
        )
          issue(
            preset.issues,
            key,
            t("当前出版器不支持此样式字段：{0}", key),
            true,
          );
      }
    }
  const preferred = raw.default_preset;
  if (
    preferred !== undefined &&
    (typeof preferred !== "string" ||
      !presets.some((preset) => preset.id === preferred))
  )
    issue(issues, "default_preset", t("默认出版预设必须指向已定义的预设 ID。"));
  return {
    presets,
    issues,
    preferred: typeof preferred === "string" ? preferred : undefined,
  };
}

export function publicationStyle(raw: Table, preset: V2Preset) {
  const style: Table = {};
  for (const key of styleSections)
    if (preset.raw[key] !== undefined) style[key] = preset.raw[key];
  const merged = merge(raw, style);
  const systemFont = readSystemFontSetting(preset.raw);
  const body = style.body;
  return systemFont || (isTable(body) && (body.font !== undefined || body.font_family !== undefined))
    ? setSystemFontSetting(merged, systemFont)
    : merged;
}

export function resolveV2Publication(
  preset: V2Preset,
  raw: Table,
  metadata: Table,
  mode: string,
) {
  const settings = inspectV2Settings(
    publicationStyle(raw, preset),
    mode,
  ).settings;
  const publication = defaultPublication("", "00");
  const options = preset.raw[preset.format] as Table;
  const mm = (v: unknown, fallback: number) =>
    (Number(v ?? fallback) * 96) / 25.4;
  const value = (key: string) =>
    typeof metadata[key] === "string" ? (metadata[key] as string) : "";
  const creators = Array.isArray(metadata.creators)
    ? (metadata.creators as string[])
    : [];
  publication.metadata = {
    title: value("title"),
    author: creators.join("; "),
    language: value("language"),
    identifier: value("identifier"),
    modified: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    publisher: value("publisher"),
    description: value("description"),
    rights: value("rights"),
    cover: value("cover"),
  };
  publication.v2 = {
    id: preset.id,
    format: preset.format,
    fixed: options.layout === "fixed",
    creators,
    firstSingle:
      preset.format === "epub" &&
      (typeof options.first_single === "boolean"
        ? options.first_single
        : Boolean(settings.v2?.firstSingle)),
  };
  settings.layout = {
    page_width: 720,
    margin_top: 0,
    margin_bottom: 0,
    margin_left: 0,
    margin_right: 0,
  };
  if (preset.format === "pdf") {
    Object.assign(publication.pdf, {
      page_width: mm(options.page_width, 210),
      page_height: mm(options.page_height, 297),
      chapter_break: options.chapter_break === "page" ? "page" : "none",
      include_toc: options.include_toc === true,
      include_cover: options.include_cover === true,
      page_numbers: false,
    });
    settings.layout = {
      page_width: publication.pdf.page_width!,
      margin_top: mm(options.margin_top, 20),
      margin_bottom: mm(options.margin_bottom, 20),
      margin_left: mm(options.margin_left, 20),
      margin_right: mm(options.margin_right, 20),
    };
  } else {
    const fixed = publication.v2.fixed;
    publication.epub = {
      layout: fixed ? "pre-paginated" : "reflowable",
      include_cover: options.include_cover === true,
      embed_font:
        typeof options.embed_font === "boolean" ? options.embed_font : fixed || !!systemFontName(settings.appearance.font_family),
      toc_in_spine: options.toc_in_spine === true,
      direction: (options.direction ??
        settings.mode.comic
          .reading_direction) as PublicationSettings["epub"]["direction"],
    };
    settings.mode.comic.spread_mode = (options.spread ??
      settings.mode.comic.spread_mode) as "single" | "double";
    publication.pdf.page_width = settings.layout.page_width = Number(
      options.page_width ?? 800,
    );
    publication.pdf.page_height = Number(options.page_height ?? 1200);
  }
  return { settings, publication };
}
