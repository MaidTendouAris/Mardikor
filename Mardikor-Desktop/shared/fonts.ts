import { t } from "./i18n";

export const fallbackFontFile = "NotoSansCJKsc-Regular.otf";
export const fallbackFontUrl = "mardikor-media://fonts/" + fallbackFontFile;
export const fallbackFontFamily = "MardikorFallback";
const systemFontPrefix = "system-font:";

export interface SystemFont {
  postscriptName: string;
  fullName: string;
  family: string;
}

export function validSystemFontName(value: unknown): value is string {
  return (
    typeof value === "string" && /^[\x21-\x7e]{1,127}(?![\s\S])/.test(value)
  );
}

export function systemFontReference(name: string) {
  return systemFontPrefix + name;
}

export function systemFontName(value: unknown) {
  if (typeof value !== "string" || !value.startsWith(systemFontPrefix)) return;
  const name = value.slice(systemFontPrefix.length);
  return validSystemFontName(name) ? name : undefined;
}

export function isFontFile(name: string) {
  return /\.(?:otf|ttf)$/i.test(name);
}

export function bundledFontChoices(): [string, string][] {
  return [
    ["sans-serif", t("Noto Sans CJK SC（内置回退字体）")],
    ["serif", t("Noto Serif CJK SC（内置衬线）")],
    ["monospace", t("Noto Sans Mono CJK SC（内置等宽）")],
  ];
}

export function projectFontChoices(
  fonts: string[],
  selected: string,
): [string, string][] {
  const choices: [string, string][] = fonts.map((path) => [path, path]);
  if (selected.startsWith("resources/") && !fonts.includes(selected))
    choices.push([selected, t("{0}（字体文件缺失）", selected)]);
  return choices;
}
