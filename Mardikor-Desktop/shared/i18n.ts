import english from "./locales/en";

export const languagePreferences = ["system", "en", "zh-CN"] as const;
export type LanguagePreference = (typeof languagePreferences)[number];
export type AppLocale = Exclude<LanguagePreference, "system">;

export function resolveAppLocale(
  preference: LanguagePreference | undefined,
  systemLocale: string,
): AppLocale {
  if (preference === "en" || preference === "zh-CN") return preference;
  try {
    const locale = new Intl.Locale(
      systemLocale.replaceAll("_", "-"),
    ).maximize();
    if (locale.language === "zh" && locale.script === "Hans") return "zh-CN";
  } catch {
    // An unavailable or unrecognized system locale uses English.
  }
  return "en";
}

let locale: AppLocale = "zh-CN";
export function setAppLocale(value: AppLocale) {
  locale = value;
}
export function appLocale() {
  return locale;
}

export function t(key: keyof typeof english, ...values: unknown[]) {
  const message = locale === "en" ? english[key] : key;
  return values.length
    ? message.replace(/\{(\d+)\}/g, (match, index: string) =>
        Number(index) < values.length ? String(values[Number(index)]) : match,
      )
    : message;
}
