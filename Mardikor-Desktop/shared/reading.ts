export const maxReadingPresets = 16;

export const readingRanges = {
  fontSize: { min: 12, max: 42, step: 1 },
  lineHeight: { min: 1, max: 2.8, step: 0.1 },
  paragraphSpacing: { min: 0, max: 2, step: 0.1 },
  firstLineIndent: { min: 0, max: 4, step: 0.5 },
  textWidth: { min: 400, max: 1440, step: 1 },
  pageGap: { min: 0, max: 120, step: 1 },
  pageMarginInline: { min: 0, max: 120, step: 1 },
  pageMarginBlock: { min: 0, max: 80, step: 1 },
} as const;

export interface ReadingStyle {
  layout: "paged" | "scroll";
  font: "system" | "serif" | "mono";
  fontSize: number;
  lineHeight: number;
  paragraphSpacing: number;
  firstLineIndent: number;
  textWidth: number;
  widthMode: "fit" | "limited";
  bookSpread: "auto" | "single" | "double";
  pageGap: number;
  pageMarginInline: number;
  pageMarginBlock: number;
  justify: boolean;
  hideSidebars: boolean;
  numberHeadings: boolean;
  comicSpread: "single" | "double";
  comicDirection: "ltr" | "rtl";
  comicFit: "contain" | "width";
}

export interface ReadingPreset {
  id: string;
  name: string;
  style: ReadingStyle;
}

export interface ReadingPreferences {
  style: ReadingStyle;
  presets: ReadingPreset[];
}
export type ReadingChange =
  | { kind: "style"; style: ReadingStyle }
  | { kind: "create"; name: string; style: ReadingStyle }
  | { kind: "rename"; id: string; name: string }
  | { kind: "update"; id: string; style: ReadingStyle }
  | { kind: "apply" | "remove"; id: string };

export const defaultReadingStyle: ReadingStyle = {
  layout: "paged",
  font: "system",
  fontSize: 18,
  lineHeight: 1.7,
  paragraphSpacing: 0.7,
  firstLineIndent: 0,
  textWidth: 760,
  widthMode: "fit",
  bookSpread: "auto",
  pageGap: 40,
  pageMarginInline: 32,
  pageMarginBlock: 20,
  justify: false,
  hideSidebars: false,
  numberHeadings: false,
  comicSpread: "single",
  comicDirection: "ltr",
  comicFit: "contain",
};

export const defaultReadingPreferences: ReadingPreferences = {
  style: defaultReadingStyle,
  presets: [],
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function readingStyle(value: unknown): ReadingStyle {
  const style = record(value);
  function number(key: keyof typeof readingRanges) {
    const value = style[key];
    const { min, max } = readingRanges[key];
    return typeof value === "number" && Number.isFinite(value)
      ? Math.min(max, Math.max(min, value))
      : defaultReadingStyle[key];
  }
  return {
    layout: style.layout === "scroll" ? "scroll" : "paged",
    font:
      style.font === "serif" || style.font === "mono" ? style.font : "system",
    fontSize: number("fontSize"),
    lineHeight: number("lineHeight"),
    paragraphSpacing: number("paragraphSpacing"),
    firstLineIndent: number("firstLineIndent"),
    textWidth: number("textWidth"),
    widthMode:
      style.widthMode === "limited" ||
      (style.widthMode === undefined &&
        typeof style.textWidth === "number" &&
        Number.isFinite(style.textWidth) &&
        style.textWidth !== defaultReadingStyle.textWidth)
        ? "limited"
        : "fit",
    bookSpread:
      style.bookSpread === "single" || style.bookSpread === "double"
        ? style.bookSpread
        : "auto",
    pageGap: number("pageGap"),
    pageMarginInline: number("pageMarginInline"),
    pageMarginBlock: number("pageMarginBlock"),
    justify: style.justify === true,
    hideSidebars: style.hideSidebars === true,
    numberHeadings: style.numberHeadings === true,
    comicSpread: style.comicSpread === "double" ? "double" : "single",
    comicDirection: style.comicDirection === "rtl" ? "rtl" : "ltr",
    comicFit: style.comicFit === "width" ? "width" : "contain",
  };
}

export function normalizeReadingPreferences(
  value: unknown,
): ReadingPreferences {
  const preferences = record(value);
  const presets: ReadingPreset[] = [];
  const ids = new Set<string>();
  if (Array.isArray(preferences.presets)) {
    for (const item of preferences.presets.slice(0, maxReadingPresets)) {
      const { id, name, style } = record(item);
      if (
        typeof id !== "string" ||
        !id ||
        id.length > 64 ||
        ids.has(id) ||
        typeof name !== "string" ||
        !name.trim()
      )
        continue;
      ids.add(id);
      presets.push({
        id,
        name: name.trim().slice(0, 48),
        style: readingStyle(style),
      });
    }
  }
  return { style: readingStyle(preferences.style), presets };
}
