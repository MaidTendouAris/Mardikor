import { defaultSettings } from "./defaults";
import { parse, stringify } from "smol-toml";
import type { MdkContents, MdkSettings } from "./mdk";
export type Table = Record<string, unknown>;
export const isTable = (value: unknown): value is Table =>
  !!value &&
  typeof value === "object" &&
  [null, Object.prototype].includes(Object.getPrototypeOf(value));
export const stripBom = (source: string) =>
  source.startsWith("\uFEFF") ? source.slice(1) : source;
export function containsControl(value: string) {
  for (let i = 0; i < value.length; i++)
    if (value.charCodeAt(i) < 32 || value.charCodeAt(i) === 127) return true;
  return false;
}
export function normalizeMode(mode: string) {
  if (typeof mode !== "string" || !/^[0-9a-f]{2}$/i.test(mode))
    throw new Error("mode 必须是两位 ASCII 十六进制字符。");
  return mode.toUpperCase();
}
export function validatePath(name: string) {
  if (
    typeof name !== "string" ||
    !name ||
    /[\\:]/.test(name) ||
    containsControl(name) ||
    name.startsWith("/") ||
    name.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new Error(`不安全的工程内部路径：${name}`);
}
export function validateContents(
  value: unknown,
  _paths?: Set<string>,
): asserts value is MdkContents {
  if (!isTable(value) || value.schema_version !== 1)
    throw new Error(
      "contents.toml 的 schema_version 必须为整数 1；更高版本需要升级应用。",
    );
  if (value.entries === undefined) value.entries = [];
  if (!Array.isArray(value.entries)) throw new Error("entries 必须为数组。");
  for (const key of [
    "appearance",
    "layout",
    "colors",
    "preview",
    "export",
    "mode",
  ])
    if (key in value)
      throw new Error(
        `contents.toml 只控制目录；${key} 应写入 settings.toml。`,
      );
  const ids = new Set<string>(),
    positions = new Set<string>();
  for (const entry of value.entries) {
    if (!isTable(entry) || typeof entry.id !== "string" || !entry.id.trim())
      throw new Error("目录项必须包含非空稳定 id。");
    if (
      typeof entry.position !== "string" ||
      !/^[1-9][0-9]*(\.[1-9][0-9]*){0,5}$/.test(entry.position)
    )
      throw new Error(`无效的目录位置：${entry.position}`);
    if (
      typeof entry.path !== "string" ||
      !entry.path.startsWith("markdown/") ||
      !entry.path.endsWith(".md")
    )
      throw new Error("目录项必须指向 markdown/ 下的 .md 文件。");
    validatePath(entry.path);
    if (ids.has(entry.id) || positions.has(entry.position))
      throw new Error("目录项 id 或 position 重复。");
    ids.add(entry.id);
    positions.add(entry.position);
  }
}
export function merge(base: Table, patch: Table): Table {
  const result: Table = Object.assign(Object.create(null), base);
  for (const [key, value] of Object.entries(patch))
    result[key] =
      isTable(value) && isTable(base[key]) ? merge(base[key], value) : value;
  return result;
}
const numeric = [
  "appearance.font_size",
  "appearance.line_height",
  "appearance.paragraph_spacing",
  "layout.page_width",
  "layout.margin_top",
  "layout.margin_bottom",
  "layout.margin_left",
  "layout.margin_right",
];
// Preserve unknown integer values, while distinguishing TOML 1 from 1.0 for
// schema and integer-only fields. Known display numbers use JS finite numbers.
export function parseToml(source: string): Table {
  const value = parse(stripBom(source), { integersAsBigInt: true }) as Table;
  if ("schema_version" in value)
    value.schema_version =
      typeof value.schema_version === "bigint"
        ? Number(value.schema_version)
        : Number.NaN;
  for (const key of [...numeric, "mode.book.toc_depth"]) {
    const parts = key.split(".");
    let parent: unknown = value;
    for (const part of parts.slice(0, -1))
      parent = isTable(parent) ? parent[part] : undefined;
    const last = parts.at(-1)!;
    if (isTable(parent) && last in parent) {
      if (typeof parent[last] === "bigint") parent[last] = Number(parent[last]);
      else if (key === "mode.book.toc_depth") parent[last] = Number.NaN;
    }
  }
  return value;
}
export function stringifyToml(value: Table): string {
  const copy = { ...value };
  if (
    typeof copy.schema_version === "number" &&
    Number.isInteger(copy.schema_version)
  )
    copy.schema_version = BigInt(copy.schema_version);
  if (
    isTable(copy.mode) &&
    isTable(copy.mode.book) &&
    typeof copy.mode.book.toc_depth === "number" &&
    Number.isInteger(copy.mode.book.toc_depth)
  )
    copy.mode = {
      ...copy.mode,
      book: { ...copy.mode.book, toc_depth: BigInt(copy.mode.book.toc_depth) },
    };
  return stringify(copy, { numbersAsFloat: true });
}
export type SettingsProblem = { field: string; message: string };
export function inspectSettings(value: unknown): {
  settings: MdkSettings;
  problems: SettingsProblem[];
  readonly: boolean;
} {
  const defaults = defaultSettings(),
    problems: SettingsProblem[] = [];
  const problem = (field: string, message: string) =>
    problems.push({ field, message });
  if (!isTable(value) || value.schema_version !== 1) {
    problem(
      "schema_version",
      "settings.toml 的 schema_version 必须为整数 1；整份设置临时使用默认值，原文件保持不变。",
    );
    return {
      settings: defaults,
      problems,
      readonly:
        isTable(value) &&
        typeof value.schema_version === "number" &&
        value.schema_version > 1,
    };
  }
  const result = merge(defaults as unknown as Table, value);
  const visit = (base: Table, patch: Table, target: Table, prefix = "") => {
    for (const [key, fallback] of Object.entries(base)) {
      if (!(key in patch)) continue;
      const path = prefix ? prefix + "." + key : key,
        current = patch[key];
      if (isTable(fallback)) {
        if (!isTable(current)) {
          target[key] = structuredClone(fallback);
          problem(path, `${path} 必须为表；该表临时使用默认值。`);
        } else visit(fallback, current, target[key] as Table, path);
        continue;
      }
      let valid = typeof current === typeof fallback;
      if (typeof fallback === "number")
        valid = valid && Number.isFinite(current);
      if (["appearance.theme", "appearance.font_family"].includes(path))
        valid = valid && typeof current === "string" && !!current.trim();
      if (numeric.includes(path))
        valid =
          valid &&
          typeof current === "number" &&
          (path.endsWith("font_size") ||
          path.endsWith("line_height") ||
          path.endsWith("page_width")
            ? current > 0
            : current >= 0);
      if (path.startsWith("colors."))
        valid =
          valid &&
          typeof current === "string" &&
          /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(
            current,
          );
      if (path === "mode.book.toc_depth")
        valid =
          valid &&
          Number.isInteger(current) &&
          Number(current) >= 1 &&
          Number(current) <= 6;
      const choices: Record<string, string[]> = {
        "mode.comic.reading_direction": ["ltr", "rtl"],
        "mode.comic.page_fit": ["contain", "cover", "width"],
        "mode.comic.spread_mode": ["single", "double"],
      };
      if (choices[path])
        valid = valid && choices[path].includes(current as string);
      if (
        path === "appearance.font_family" &&
        typeof current === "string" &&
        current.startsWith("resources/font/")
      ) {
        try {
          validatePath(current);
        } catch {
          valid = false;
        }
      }
      if (!valid) {
        target[key] = fallback;
        problem(
          path,
          `${path} 的类型或取值无效；临时使用 ${String(fallback)}。`,
        );
      }
    }
  };
  visit(defaults as unknown as Table, value, result);
  const settings = result as unknown as MdkSettings;
  if (
    settings.layout.margin_left + settings.layout.margin_right >=
    settings.layout.page_width
  ) {
    for (const key of ["page_width", "margin_left", "margin_right"] as const)
      settings.layout[key] = defaults.layout[key];
    problem(
      "layout",
      "左右边距之和必须小于页宽；页宽与左右边距临时使用 720 / 32 / 32，其他字段保持有效值。",
    );
  }
  return { settings, problems, readonly: false };
}
export function resolveSettings(value: unknown): MdkSettings {
  const result = inspectSettings(value);
  if (result.problems.length)
    throw new Error(result.problems.map((p) => p.message).join("\n"));
  return result.settings;
}
export function settingsChanges(old: Table, value: MdkSettings): Table {
  const info = inspectSettings(old),
    effective = info.settings as unknown as Table;
  const visit = (
    shape: Table,
    previous: Table,
    next: Table,
    prefix = "",
  ): Table => {
    const patch: Table = {};
    for (const [key, fallback] of Object.entries(shape)) {
      const path = prefix ? prefix + "." + key : key;
      if (isTable(fallback)) {
        const child = visit(
          fallback,
          previous[key] as Table,
          next[key] as Table,
          path,
        );
        if (Object.keys(child).length) patch[key] = child;
      } else if (
        next[key] !== previous[key] ||
        info.problems.some(
          (p) =>
            p.field === path ||
            path.startsWith(p.field + ".") ||
            p.field === "schema_version",
        )
      )
        patch[key] = next[key];
    }
    return patch;
  };
  return {
    ...visit(
      defaultSettings() as unknown as Table,
      effective,
      value as unknown as Table,
    ),
    schema_version: 1,
  };
}
export function validateSourceText(
  path: string,
  content: string,
  _paths?: Set<string>,
) {
  if (path === "mimetype" && content !== "application/vnd.mardikor.mdk+zip")
    throw new Error("mimetype 必须保持规范中的固定值。");
  if (/\.toml$/i.test(path)) {
    const value = parseToml(content);
    if (path === "contents.toml") validateContents(value);
    if (path === "settings.toml") resolveSettings(value);
  }
  if (/\.json$/i.test(path)) JSON.parse(content);
}
