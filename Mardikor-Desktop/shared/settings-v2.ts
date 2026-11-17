import { defaultSettings } from "./defaults";
import { t } from "./i18n";
import type { MdkSettings } from "./mdk";
import {
  isTable,
  merge,
  validatePath,
  type SettingsProblem,
  type Table,
} from "./schema";
import { settingsFields } from "./settings-v2-fields";
import { typographySupports } from "./v2-typography";

export const applicationNamespace = "com.mardikor.editor";
const supportsReadingStyle = (field: string) =>
  /^(?:toc\.|document_title\.|numbering\.)/.test(field) &&
  Object.hasOwn(settingsFields, field);
const number = (v: unknown) =>
  (typeof v === "number" || typeof v === "bigint") &&
  Number.isFinite(Number(v));
const positive = (v: unknown) => number(v) && Number(v) > 0;
const nonnegative = (v: unknown) => number(v) && Number(v) >= 0;
const color = (v: unknown) =>
  typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
const boolean = (v: unknown) => typeof v === "boolean";
const oneOf =
  (...values: string[]) =>
  (v: unknown) =>
    typeof v === "string" && values.includes(v);
const integer = (v: unknown) =>
  typeof v === "bigint" || Number.isSafeInteger(v);

export function fontReference(v: unknown) {
  if (typeof v !== "string") return false;
  if (v === "generic" || /^@[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(v))
    return true;
  try {
    validatePath(v);
    return v.startsWith("resources/");
  } catch {
    return false;
  }
}

export const basicSettings = {
  body: {
    font_family: oneOf("serif", "sans-serif", "monospace"),
    font: fontReference,
    font_size: positive,
    line_height: positive,
    paragraph_spacing: nonnegative,
    text_color: color,
    background_color: color,
    link_color: color,
  },
  preview: { max_width: positive },
  reading: {
    direction: oneOf("ltr", "rtl"),
    spread: oneOf("single", "double"),
    image_fit: oneOf("contain", "cover", "width"),
    show_toc: boolean,
    chapter_numbering: boolean,
  },
} satisfies Record<string, Record<string, (value: unknown) => boolean>>;
const additionalSettings = {
  preview: {
    layout: oneOf("continuous", "document"),
    viewport_height: positive,
    padding_block: nonnegative,
    padding_inline: nonnegative,
    canvas_color: color,
    document_gap: nonnegative,
    spread_gap: nonnegative,
    border_color: color,
    border_width: nonnegative,
    radius: nonnegative,
  },
  reading: {
    first_single: boolean,
    show_project_title: boolean,
    show_creators: boolean,
    show_description: boolean,
    show_cover: boolean,
  },
  toc: {
    heading_max_level: (v: unknown) =>
      integer(v) && Number(v) >= 1 && Number(v) <= 6,
  },
  quote: { text_color: color },
};
const integerBetween = (value: unknown, min: number, max: number) =>
  typeof value === "bigint" && value >= BigInt(min) && value <= BigInt(max);
function checkSetting(
  kind: string | readonly string[],
  value: unknown,
): boolean {
  if (typeof kind !== "string")
    return typeof value === "string" && kind.includes(value);
  switch (kind) {
    case "bool":
      return boolean(value);
    case "positive":
      return positive(value);
    case "nonnegative":
      return nonnegative(value);
    case "finite":
      return number(value);
    case "color":
      return color(value);
    case "paint":
      return value === "none" || color(value);
    case "font-ref":
      return fontReference(value);
    case "family":
      return oneOf("serif", "sans-serif", "monospace")(value);
    case "align":
      return oneOf("start", "end", "center", "justify")(value);
    case "font-list":
      return (
        Array.isArray(value) &&
        value.every((font) => font !== "generic" && fontReference(font))
      );
    case "font-path":
      return (
        typeof value === "string" &&
        value.startsWith("resources/") &&
        fontReference(value)
      );
    case "id":
      return (
        typeof value === "string" &&
        /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)
      );
    case "weight":
      return integerBetween(value, 1, 1000);
    case "heading-level":
      return integerBetween(value, 1, 6);
    case "depth":
      return integerBetween(value, 0, 2147483647);
    case "positive-int":
      return integerBetween(value, 1, 2147483647);
    case "percentage":
      return positive(value) && Number(value) <= 100;
    case "numbering": {
      if (typeof value !== "string" || !/\{(?:path|index)\}/.test(value))
        return false;
      return !/[{}\p{Cc}\p{Zl}\p{Zp}]/u.test(
        value.replace(/\{(?:path|index)\}/g, ""),
      );
    }
    default:
      return false;
  }
}

function inspectCatalogue(raw: Table) {
  const problems: SettingsProblem[] = [];
  const explicit: Record<string, string | number | boolean> = {};
  const invalid = (field: string) =>
    problems.push({ field, message: t("{0} 的类型或取值无效。", field) });
  const knownTables = new Set(
    Object.keys(settingsFields).map((path) => path.split(".")[0]),
  );
  function visit(value: unknown, field: string) {
    const key = field.replace(
      /^headings\.h[1-6]\.(?!size_scale$)/,
      "headings.",
    );
    const definition = settingsFields[key];
    if (definition) {
      if (!checkSetting(definition[0], value)) invalid(field);
      else if (["string", "boolean", "number", "bigint"].includes(typeof value))
        explicit[field] = (
          typeof value === "bigint" ? Number(value) : value
        ) as string | number | boolean;
      return;
    }
    if (field === "headings.size_scale") invalid(field);
    else if (
      knownTables.has(field) ||
      /^headings\.h[1-6]$/.test(field) ||
      field === "code.palette"
    ) {
      if (!isTable(value)) invalid(field);
      else
        for (const [key, item] of Object.entries(value))
          visit(item, field + "." + key);
    }
  }
  for (const [key, value] of Object.entries(raw)) {
    if (key !== "font_sets") visit(value, key);
    else if (!Array.isArray(value)) invalid(key);
    else {
      const ids = new Set<string>();
      for (const [index, fontSet] of value.entries()) {
        const prefix = "font_sets." + index + ".";
        if (!isTable(fontSet)) {
          invalid(prefix.slice(0, -1));
          continue;
        }
        for (const field of [
          "id",
          "regular",
          "bold",
          "italic",
          "bold_italic",
        ]) {
          if (
            fontSet[field] === undefined &&
            !["id", "regular"].includes(field)
          )
            continue;
          if (
            !checkSetting(
              settingsFields["font_sets[]." + field][0],
              fontSet[field],
            )
          )
            invalid(prefix + field);
        }
        if (typeof fontSet.id === "string" && ids.has(fontSet.id))
          invalid(prefix + "id");
        if (typeof fontSet.id === "string") ids.add(fontSet.id);
      }
    }
  }
  return { problems, explicit };
}

export function inspectV2Settings(raw: Table, mode: string) {
  const settings = defaultSettings(),
    unsupported: string[] = [];
  const catalogue = inspectCatalogue(raw);
  const problems = new Map(
    catalogue.problems.map((issue) => [issue.field, issue]),
  );
  const problem = (field: string, message: string) =>
    problems.set(field, { field, message });
  function section(
    name: string,
    fields: Record<string, (value: unknown) => boolean>,
  ): Table {
    const value = raw[name];
    if (value === undefined) return {};
    if (!isTable(value)) {
      problem(name, t("{0} 必须为表。", name));
      return {};
    }
    const result: Table = {};
    for (const [key, valid] of Object.entries(fields)) {
      if (!Object.hasOwn(value, key)) continue;
      if (valid(value[key]))
        result[key] =
          typeof value[key] === "bigint" ? Number(value[key]) : value[key];
      else
        problem(
          name + "." + key,
          t("{0} 的类型或取值无效。", name + "." + key),
        );
    }
    for (const key of Object.keys(value))
      if (
        !Object.hasOwn(fields, key) &&
        !supportsReadingStyle(name + "." + key) &&
        !typographySupports(name + "." + key)
      )
        unsupported.push(name + "." + key);
    return result;
  }
  const body = section("body", basicSettings.body);
  const preview = section("preview", {
    ...basicSettings.preview,
    ...additionalSettings.preview,
  });
  const reading = section("reading", {
    ...basicSettings.reading,
    ...additionalSettings.reading,
  });
  const toc = section("toc", additionalSettings.toc);
  const quote = section("quote", additionalSettings.quote);
  const extensions = raw.extensions;
  if (extensions !== undefined && !isTable(extensions))
    problem("extensions", t("extensions 必须为表。"));
  const app = isTable(extensions)
    ? extensions[applicationNamespace]
    : undefined;
  for (const [key, value] of Object.entries(raw)) {
    if (
      ["body", "preview", "reading", "toc", "quote", "extensions"].includes(key)
    )
      continue;
    if (!isTable(value) || !Object.keys(value).length) unsupported.push(key);
    else
      for (const field of Object.keys(value)) {
        const scope = key + "." + field;
        const child = value[field];
        if (key === "headings" && /^h[1-6]$/.test(field) && isTable(child)) {
          for (const name of Object.keys(child))
            if (!typographySupports(scope + "." + name))
              unsupported.push(scope + "." + name);
        } else if (!supportsReadingStyle(scope) && !typographySupports(scope))
          unsupported.push(scope);
      }
  }
  if (typeof body.font === "string" && body.font.startsWith("@"))
    unsupported.push("body.font");
  const view = {
    layout: (preview.layout ?? (mode === "02" ? "document" : "continuous")) as
      "continuous" | "document",
    width: Number(preview.max_width ?? 720),
    height: Number(preview.viewport_height ?? 960),
    block: Number(preview.padding_block ?? 24),
    inline: Number(preview.padding_inline ?? 32),
    border: Number(preview.border_width ?? 0),
    radius: Number(preview.radius ?? 0),
    borderColor: String(preview.border_color ?? "#d8e0eb"),
    color: String(preview.canvas_color ?? "#f3f6fb"),
    documentGap: Number(preview.document_gap ?? 24),
    spreadGap: Number(preview.spread_gap ?? 24),
  };
  const vertical = String(catalogue.explicit["body.writing_mode"]).startsWith(
    "vertical-",
  );
  if (
    (vertical ? view.block : view.inline) * 2 + view.border * 2 >= view.width ||
    (view.layout === "document" &&
      (vertical ? view.inline : view.block) * 2 + view.border * 2 >=
        view.height)
  ) {
    problem("preview.geometry", t("预览边距和边框必须留出正的内容区域。"));
    Object.assign(view, {
      width: 720,
      height: 960,
      block: 24,
      inline: 32,
      border: 0,
    });
  }
  const minHeading = Number(catalogue.explicit["toc.heading_min_level"] ?? 1);
  let maxHeading = Number(toc.heading_max_level ?? 3);
  if (minHeading > maxHeading) {
    problem("toc.heading_range", t("目录的最小标题级别不能超过最大级别。"));
    maxHeading = 3;
    delete catalogue.explicit["toc.heading_min_level"];
    delete catalogue.explicit["toc.heading_max_level"];
  }
  const family = (body.font_family ?? "sans-serif") as string;
  settings.appearance = {
    theme: "default",
    font_family:
      typeof body.font === "string" && body.font.startsWith("resources/")
        ? body.font
        : family,
    font_size: (body.font_size ?? 16) as number,
    line_height: (body.line_height ?? 1.7) as number,
    paragraph_spacing: (body.paragraph_spacing ?? 0.8) as number,
  };
  settings.colors = {
    text: (body.text_color ?? "#1f2933") as string,
    background: (body.background_color ?? "#ffffff") as string,
    link: (body.link_color ?? "#2563eb") as string,
    quote: (quote.text_color ?? body.text_color ?? "#1f2933") as string,
  };
  settings.layout = {
    page_width: view.width,
    margin_top: view.block,
    margin_bottom: view.block,
    margin_left: view.inline,
    margin_right: view.inline,
  };
  settings.preview.show_toc = (reading.show_toc ?? mode === "01") as boolean;
  settings.preview.render_containers = false;
  settings.mode.book.toc_depth = maxHeading;
  settings.mode.book.chapter_numbering = (reading.chapter_numbering ??
    mode === "01") as boolean;
  settings.mode.comic = {
    reading_direction: (reading.direction ?? "ltr") as "ltr" | "rtl",
    spread_mode: (reading.spread ?? "single") as "single" | "double",
    page_fit: (reading.image_fit ?? "contain") as "contain" | "cover" | "width",
  };
  settings.v2 = {
    previewLayout: view.layout,
    firstSingle: reading.first_single === true,
    fontFamily: family as "serif" | "sans-serif" | "monospace",
    view,
    projectTitle: reading.show_project_title === true,
    creators: reading.show_creators === true,
    description: reading.show_description === true,
    cover: reading.show_cover === true,
    values: catalogue.explicit,
  };
  settings.export.mdk.generate_contents_markdown =
    isTable(app) && app.generate_contents_markdown === true;
  return {
    settings,
    problems: [...problems.values()],
    unsupported,
    readonly: false,
  };
}

// Convert edits from the application view model without materializing resolved defaults.
export function updateV2Settings(
  raw: Table,
  before: MdkSettings,
  after: MdkSettings,
) {
  const patch: Table = {};
  function set(table: string, key: string, value: unknown) {
    const section = (patch[table] ??= {}) as Table;
    section[key] = value;
  }
  for (const key of ["font_size", "line_height", "paragraph_spacing"] as const)
    if (before.appearance[key] !== after.appearance[key])
      set("body", key, after.appearance[key]);
  if (before.appearance.font_family !== after.appearance.font_family) {
    const font = after.appearance.font_family;
    if (font.startsWith("resources/") || font.startsWith("@"))
      set("body", "font", font);
    else {
      set("body", "font", "generic");
      set("body", "font_family", font);
    }
  }
  for (const key of ["text", "background", "link"] as const)
    if (before.colors[key] !== after.colors[key])
      set("body", key + "_color", after.colors[key]);
  if (before.colors.quote !== after.colors.quote)
    set("quote", "text_color", after.colors.quote);
  if (before.layout.page_width !== after.layout.page_width)
    set("preview", "max_width", after.layout.page_width);
  if (before.preview.show_toc !== after.preview.show_toc)
    set("reading", "show_toc", after.preview.show_toc);
  if (before.mode.book.chapter_numbering !== after.mode.book.chapter_numbering)
    set("reading", "chapter_numbering", after.mode.book.chapter_numbering);
  if (before.mode.book.toc_depth !== after.mode.book.toc_depth)
    set("toc", "heading_max_level", BigInt(after.mode.book.toc_depth));
  for (const [view, field] of Object.entries({
    reading_direction: "direction",
    spread_mode: "spread",
    page_fit: "image_fit",
  }) as [keyof MdkSettings["mode"]["comic"], string][])
    if (before.mode.comic[view] !== after.mode.comic[view])
      set("reading", field, after.mode.comic[view]);
  if (
    after.v2?.previewLayout &&
    before.v2?.previewLayout !== after.v2.previewLayout
  )
    set("preview", "layout", after.v2.previewLayout);
  if (after.v2 && before.v2) {
    const previewFields = {
      height: "viewport_height",
      block: "padding_block",
      inline: "padding_inline",
      border: "border_width",
      radius: "radius",
      borderColor: "border_color",
      color: "canvas_color",
      documentGap: "document_gap",
      spreadGap: "spread_gap",
    } as const;
    for (const view of Object.keys(
      previewFields,
    ) as (keyof typeof previewFields)[])
      if (before.v2.view[view] !== after.v2.view[view])
        set("preview", previewFields[view], after.v2.view[view]);
    const readingFields = {
      firstSingle: "first_single",
      projectTitle: "show_project_title",
      creators: "show_creators",
      description: "show_description",
      cover: "show_cover",
    } as const;
    for (const view of Object.keys(
      readingFields,
    ) as (keyof typeof readingFields)[])
      if (before.v2[view] !== after.v2[view])
        set("reading", readingFields[view], after.v2[view]);
  }
  if (
    before.export.mdk.generate_contents_markdown !==
    after.export.mdk.generate_contents_markdown
  )
    set("extensions", applicationNamespace, {
      generate_contents_markdown: after.export.mdk.generate_contents_markdown,
    });
  return { raw: merge(raw, patch), changed: Object.keys(patch).length > 0 };
}
