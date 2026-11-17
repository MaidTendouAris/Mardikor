import type Token from "markdown-it/lib/token.mjs";
import type { MdkSettings } from "./mdk";
import { settingsFields } from "./settings-v2-fields";

type Value = string | number | boolean;
type FieldRule = readonly [
  field: string,
  property: string,
  unit?: "px" | "em" | "%" | "scale",
];
const body = [
  ["font_weight", "font-weight"],
  ["font_style", "font-style"],
  ["letter_spacing", "letter-spacing", "em"],
  ["word_spacing", "word-spacing", "em"],
  ["kerning", "font-kerning"],
  ["ligatures", "font-variant-ligatures"],
  ["font_synthesis", "font-synthesis"],
  ["writing_mode", "writing-mode"],
  ["text_orientation", "text-orientation"],
  ["text_align", "text-align"],
] as const satisfies readonly FieldRule[];
const headings = [
  ["text_color", "color"],
  ["font_weight", "font-weight"],
  ["line_height", "line-height"],
  ["letter_spacing", "letter-spacing", "em"],
  ["text_align", "text-align"],
  ["spacing_before", "margin-block-start", "em"],
  ["spacing_after", "margin-block-end", "em"],
  ["size_scale", "font-size", "scale"],
  ["keep_with_next", "break-after"],
  ["break_before", "break-before"],
] as const satisfies readonly FieldRule[];
const paragraphs = [
  ["spacing_before", "margin-block-start", "em"],
  ["hyphens", "hyphens"],
  ["word_break", "word-break"],
  ["overflow_wrap", "overflow-wrap"],
  ["widows", "widows"],
  ["orphans", "orphans"],
] as const satisfies readonly FieldRule[];
const codeBox = [
  ["size_scale", "font-size", "scale"],
  ["text_color", "color"],
  ["background_color", "background-color"],
  ["border_color", "border-color"],
  ["border_width", "border-width", "px"],
  ["radius", "border-radius", "px"],
] as const satisfies readonly FieldRule[];
const inlineCode = [
  ...codeBox,
  ["padding_inline", "padding-inline", "em"],
  ["padding_block", "padding-block", "em"],
] as const satisfies readonly FieldRule[];
const code = [
  ...codeBox,
  ["line_height", "line-height"],
  ["padding", "padding", "px"],
  ["tab_size", "tab-size"],
] as const satisfies readonly FieldRule[];
const quote = [
  ["font_style", "font-style"],
  ["text_color", "color"],
  ["background_color", "background-color"],
  ["border_color", "border-inline-start-color"],
  ["border_width", "border-inline-start-width", "px"],
  ["padding_inline", "padding-inline", "em"],
  ["padding_block", "padding-block", "em"],
] as const satisfies readonly FieldRule[];
const rule = [
  ["color", "border-block-start-color"],
  ["style", "border-block-start-style"],
  ["thickness", "border-block-start-width", "px"],
  ["width", "inline-size", "%"],
  ["spacing_before", "margin-block-start", "em"],
  ["spacing_after", "margin-block-end", "em"],
] as const satisfies readonly FieldRule[];
const lists = [
  ["indent", "padding-inline-start", "em"],
] as const satisfies readonly FieldRule[];
const tables = [
  ["size_scale", "font-size", "scale"],
  ["line_height", "line-height"],
] as const satisfies readonly FieldRule[];
const cells = [
  ["cell_padding_inline", "padding-inline", "em"],
  ["cell_padding_block", "padding-block", "em"],
  ["border_color", "border-color"],
  ["border_width", "border-width", "px"],
] as const satisfies readonly FieldRule[];
const tableHeaders = [
  ["header_background_color", "background-color"],
  ["header_text_color", "color"],
  ["header_font_weight", "font-weight"],
] as const satisfies readonly FieldRule[];
const imageBox = [
  ["max_width", "max-width", "%"],
  ["max_height", "max-height", "px"],
  ["border_color", "border-color"],
  ["border_width", "border-width", "px"],
  ["radius", "border-radius", "px"],
] as const satisfies readonly FieldRule[];
const imageParagraph = [
  ["align", "text-align"],
  ["spacing_before", "margin-block-start", "em"],
  ["spacing_after", "margin-block-end", "em"],
] as const satisfies readonly FieldRule[];
const captions = [
  ["caption_size_scale", "font-size", "scale"],
  ["caption_color", "color"],
  ["caption_align", "text-align"],
  ["caption_gap", "margin-block-start", "em"],
] as const satisfies readonly FieldRule[];
const groups = {
  body,
  headings,
  paragraph: paragraphs,
  inline_code: inlineCode,
  code,
  quote,
  thematic_break: rule,
  lists,
  tables: [...tables, ...cells, ...tableHeaders],
  images: [...imageBox, ...imageParagraph, ...captions],
};
const separatelyRendered = new Set([
  "body.text_direction",
  "paragraph.first_line_indent",
  "paragraph.indent_first",
  "paragraph.indent_after_heading",
  "paragraph.soft_break",
  "links.underline",
  "links.underline_style",
  "links.underline_offset",
  "links.break_long_urls",
  "code.wrap",
  "quote.nesting_indent",
  "lists.item_spacing",
  "lists.unordered_marker",
  "lists.ordered_marker",
  "lists.marker_color",
  "tables.default_align",
  "tables.width",
  "tables.overflow",
  "tables.stripe_background_color",
  "images.caption_source",
]);

export function typographySupports(path: string) {
  const key = path.replace(/^headings\.h[1-6]\.(?!size_scale$)/, "headings.");
  if (separatelyRendered.has(key) || /^headings\.h[1-6]\.size_scale$/.test(key))
    return true;
  const [section, field] = key.split(".");
  return (
    Object.hasOwn(groups, section) &&
    (groups[section as keyof typeof groups] as readonly FieldRule[]).some(
      ([name]) => name === field,
    )
  );
}

export function v2StyleValue(
  settings: MdkSettings,
  path: string,
): Value | undefined {
  const fallback = settingsFields[path]?.[2];
  return (
    settings.v2?.values[path] ??
    (Array.isArray(fallback) ? undefined : (fallback as Value | undefined))
  );
}

function properties(
  settings: MdkSettings,
  table: string,
  fields: readonly FieldRule[],
  inherit?: string,
) {
  const style: Record<string, string> = {};
  for (const [field, prop, unit] of fields) {
    const value =
      settings.v2?.values[table + "." + field] ??
      (inherit ? v2StyleValue(settings, inherit + "." + field) : undefined) ??
      v2StyleValue(settings, table + "." + field);
    if (value === undefined) continue;
    style[prop] =
      unit === "scale"
        ? Number(value) * settings.appearance.font_size + "px"
        : prop === "font-synthesis" && value === "weight-style"
          ? "weight style"
          : prop === "break-after"
            ? value
              ? "avoid-page"
              : "auto"
            : prop === "background-color" && value === "none"
              ? "transparent"
              : String(value) + (unit ?? "");
  }
  return style;
}
export const styleDeclarations = (style: Record<string, string>) =>
  Object.entries(style)
    .map(([property, value]) => property + ":" + value)
    .join(";");

export function bodyTypography(settings: MdkSettings) {
  if (!settings.v2) return {};
  const style = properties(settings, "body", body);
  const direction = v2StyleValue(settings, "body.text_direction");
  if (
    style["text-orientation"] === "upright" &&
    style["writing-mode"]?.startsWith("vertical")
  )
    style.direction = "ltr";
  else if (direction === "ltr" || direction === "rtl")
    style.direction = direction;
  return style;
}

export function applyV2Typography(
  tokens: Token[],
  settings: MdkSettings,
  publishing = false,
) {
  if (!settings.v2) return;
  let firstParagraph = true,
    previousHeading = false;
  let quoteDepth = 0,
    bodyRow = 0;
  const indent = Number(
    v2StyleValue(settings, "paragraph.first_line_indent") ?? 0,
  );
  for (const [tokenIndex, token] of tokens.entries()) {
    let style: Record<string, string> = {};
    switch (token.type) {
      case "heading_open":
        style = properties(
          settings,
          "headings." + token.tag,
          headings,
          "headings",
        );
        style.color ??= settings.colors.text;
        previousHeading = token.level === 0;
        break;
      case "paragraph_open":
        if (token.level === 0) {
          style = properties(settings, "paragraph", paragraphs);
          if (
            indent &&
            (!firstParagraph ||
              v2StyleValue(settings, "paragraph.indent_first")) &&
            (!previousHeading ||
              v2StyleValue(settings, "paragraph.indent_after_heading"))
          )
            style["text-indent"] = indent + "em";
          firstParagraph = false;
          previousHeading = false;
        }
        break;
      case "fence":
      case "code_block":
        token.meta = {
          ...token.meta,
          v2CodeStyle: styleDeclarations({
            ...properties(settings, "code", code),
            "border-style": "solid",
            "white-space": v2StyleValue(settings, "code.wrap")
              ? "pre-wrap"
              : "pre",
            "overflow-wrap": v2StyleValue(settings, "code.wrap")
              ? "anywhere"
              : "normal",
            ...(publishing ? {} : { "overflow-x": "auto" }),
          }),
        };
        previousHeading = false;
        break;
      case "blockquote_open":
        style = properties(settings, "quote", quote);
        style.color ??= settings.colors.text;
        style["margin-inline-start"] =
          quoteDepth > 0
            ? v2StyleValue(settings, "quote.nesting_indent") + "em"
            : "0";
        quoteDepth++;
        previousHeading = false;
        break;
      case "blockquote_close":
        quoteDepth--;
        break;
      case "bullet_list_open":
      case "ordered_list_open":
        style = properties(settings, "lists", lists);
        style["--mdk-list-marker"] = String(
          v2StyleValue(settings, "lists.marker_color") ?? settings.colors.text,
        );
        if (token.type === "bullet_list_open")
          style["list-style-type"] = String(
            v2StyleValue(settings, "lists.unordered_marker"),
          );
        else {
          const marker = v2StyleValue(settings, "lists.ordered_marker");
          style["list-style-type"] =
            marker === "source" || marker === undefined
              ? token.markup === ")"
                ? "mdk-decimal-paren"
                : "decimal"
              : String(marker);
        }
        previousHeading = false;
        break;
      case "list_item_open":
        style["margin-block-end"] =
          v2StyleValue(settings, "lists.item_spacing") + "em";
        break;
      case "hr":
        style = properties(settings, "thematic_break", rule);
        style["margin-inline"] = "auto";
        previousHeading = false;
        break;
      case "table_open":
        style = properties(settings, "tables", tables);
        style.width =
          v2StyleValue(settings, "tables.width") === "full" ? "100%" : "auto";
        style["table-layout"] = "auto";
        token.attrJoin(
          "class",
          publishing || v2StyleValue(settings, "tables.overflow") === "wrap"
            ? "mdk-table-wrap"
            : "mdk-table-scroll",
        );
        previousHeading = false;
        break;
      case "tbody_open":
        bodyRow = 0;
        break;
      case "tr_open":
        if (token.level >= 2 && ++bodyRow % 2 === 0) {
          const paint = v2StyleValue(
            settings,
            "tables.stripe_background_color",
          );
          if (paint && paint !== "none")
            style["background-color"] = String(paint);
        }
        break;
      case "th_open":
      case "td_open":
        style = properties(settings, "tables", cells);
        style["border-style"] = "solid";
        if (!token.attrGet("style"))
          style["text-align"] = String(
            v2StyleValue(settings, "tables.default_align"),
          );
        if (token.type === "th_open") {
          Object.assign(style, properties(settings, "tables", tableHeaders));
          style.color ??= settings.colors.text;
        }
        break;
      case "html_block":
        previousHeading = false;
        break;
      case "inline":
        if (
          tokens[tokenIndex - 1]?.type === "paragraph_open" &&
          token.children?.length === 1 &&
          token.children[0].type === "image"
        ) {
          const image = token.children[0];
          tokens[tokenIndex - 1].attrJoin(
            "style",
            styleDeclarations(properties(settings, "images", imageParagraph)),
          );
          const source = v2StyleValue(settings, "images.caption_source");
          image.meta = {
            ...image.meta,
            v2CaptionSource: source,
            v2CaptionStyle: styleDeclarations({
              ...properties(settings, "images", captions),
              color: String(
                v2StyleValue(settings, "images.caption_color") ??
                  settings.colors.text,
              ),
            }),
          };
        }
        for (const [index, inline] of (token.children ?? []).entries()) {
          if (
            inline.type === "softbreak" &&
            v2StyleValue(settings, "paragraph.soft_break") === "line-break"
          )
            inline.type = "hardbreak";
          if (inline.type === "code_inline")
            inline.attrSet(
              "style",
              styleDeclarations({
                ...properties(settings, "inline_code", inlineCode),
                "border-style": "solid",
                "white-space": "nowrap",
              }),
            );
          if (inline.type === "link_open") {
            const link = {
              "text-decoration-line": v2StyleValue(settings, "links.underline")
                ? "underline"
                : "none",
              "text-decoration-style": String(
                v2StyleValue(settings, "links.underline_style"),
              ),
              "text-underline-offset":
                v2StyleValue(settings, "links.underline_offset") + "em",
            };
            const label = token.children?.[index + 1];
            if (
              v2StyleValue(settings, "links.break_long_urls") &&
              label?.type === "text" &&
              /^[a-z][a-z0-9+.-]*:\S+$/i.test(label.content)
            )
              Object.assign(link, { "overflow-wrap": "anywhere" });
            inline.attrJoin("style", styleDeclarations(link));
          }
          if (inline.type === "image") {
            const box = properties(settings, "images", imageBox);
            if (v2StyleValue(settings, "images.max_height") === 0)
              delete box["max-height"];
            box["border-style"] = "solid";
            inline.meta = {
              ...inline.meta,
              v2ImageStyle: styleDeclarations(box),
            };
          }
        }
        break;
    }
    if (
      ["paragraph_open", "heading_open"].includes(token.type) &&
      v2StyleValue(settings, "body.text_direction") === "auto" &&
      !(
        v2StyleValue(settings, "body.text_orientation") === "upright" &&
        String(v2StyleValue(settings, "body.writing_mode")).startsWith(
          "vertical-",
        )
      )
    )
      token.attrSet("dir", "auto");
    if (Object.keys(style).length)
      token.attrJoin("style", styleDeclarations(style));
  }
}

export function imageStyleMarkup(
  token: Token,
  alt: string,
  escape: (value: string) => string,
) {
  const { v2ImageStyle, v2CaptionSource, v2CaptionStyle } = token.meta ?? {};
  const style = v2ImageStyle ? ' style="' + escape(v2ImageStyle) + '"' : "";
  const label =
    v2CaptionSource === "alt"
      ? alt
      : v2CaptionSource === "title"
        ? (token.attrGet("title") ?? "")
        : "";
  const caption = label.trim()
    ? '<span class="mdk-image-caption" data-find-generated="" style="' +
      escape(v2CaptionStyle) +
      '">' +
      escape(label) +
      "</span>"
    : "";
  const title = token.attrGet("title");
  return {
    attributes: style + (title ? ' title="' + escape(title) + '"' : ""),
    caption,
  };
}

export const typographyComponentStyles =
  ".mdk-image-caption{display:block}.mdk-table-wrap{max-width:100%}.mdk-table-wrap td,.mdk-table-wrap th{overflow-wrap:anywhere}" +
  ".mdk-table-scroll{display:block;max-width:100%;overflow-x:auto}li::marker{color:var(--mdk-list-marker,currentColor)}" +
  '@counter-style mdk-decimal-paren{system:extends decimal;suffix:") "}';
