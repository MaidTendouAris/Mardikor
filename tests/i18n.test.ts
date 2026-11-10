import { test } from "node:test";
import assert from "node:assert/strict";
import english from "../shared/locales/en";
import { resolveAppLocale, setAppLocale, t } from "../shared/i18n";

test("system locale selects Simplified Chinese or falls back to English", () => {
  for (const locale of ["zh", "zh-CN", "zh-SG", "zh-Hans", "zh_Hans_CN"])
    assert.equal(resolveAppLocale("system", locale), "zh-CN", locale);
  for (const locale of [
    "en-GB",
    "fr-FR",
    "ja-JP",
    "zh-TW",
    "zh-HK",
    "zh-Hant-CN",
    "",
  ])
    assert.equal(resolveAppLocale("system", locale), "en", locale);
  assert.equal(resolveAppLocale("en", "zh-CN"), "en");
  assert.equal(resolveAppLocale("zh-CN", "fr-FR"), "zh-CN");
  assert.equal(resolveAppLocale(undefined, "zh-CN"), "zh-CN");
});

test("English catalog preserves interpolation placeholders and runtime values", () => {
  const placeholders = (text: string) =>
    [...text.matchAll(/\{\d+\}/g)].map(([match]) => match).sort();
  for (const [source, translation] of Object.entries(english)) {
    assert.ok(translation.trim(), source);
    assert.deepEqual(placeholders(translation), placeholders(source), source);
  }
  try {
    setAppLocale("en");
    assert.equal(
      t("找不到链接文件：{0}", "章.md"),
      "Linked file not found: 章.md",
    );
    setAppLocale("zh-CN");
    assert.equal(t("找不到链接文件：{0}", "章.md"), "找不到链接文件：章.md");
  } finally {
    setAppLocale("zh-CN");
  }
});
