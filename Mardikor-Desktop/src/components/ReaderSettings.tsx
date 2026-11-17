import { useEffect, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { SlidersHorizontal, X } from "lucide-react";
import { t } from "../../shared/i18n";
import {
  defaultReadingStyle,
  maxReadingPresets,
  readingRanges,
  type ReadingChange,
  type ReadingPreferences,
  type ReadingStyle,
} from "../../shared/reading";
import type { Ask, Notify } from "../App";
import { Select } from "./Select";

export interface ReaderSettingsProps {
  comic: boolean;
  value: ReadingPreferences;
  change: (change: ReadingChange) => Promise<ReadingPreferences>;
  ask: Ask;
  notify: Notify;
}

export function ReaderSettings({
  comic,
  value,
  change,
  ask,
  notify,
}: ReaderSettingsProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value.style);
  const [presetId, setPresetId] = useState("");
  const [saving, setSaving] = useState(false);
  const selected = value.presets.find(({ id }) => id === presetId);
  const full = value.presets.length >= maxReadingPresets;
  useEffect(() => {
    setDraft(value.style);
  }, [value.style]);

  function set<K extends keyof ReadingStyle>(key: K, next: ReadingStyle[K]) {
    setDraft((current) => ({ ...current, [key]: next }));
  }
  async function save(action: ReadingChange) {
    setSaving(true);
    try {
      return await change(action);
    } catch (error) {
      notify(String(error), true);
    } finally {
      setSaving(false);
    }
  }
  async function namePreset(rename: boolean) {
    const name = await ask({
      title: rename ? t("重命名阅读预设") : t("保存为阅读预设"),
      initial: rename
        ? selected?.name
        : t("阅读预设 {0}", value.presets.length + 1),
      input: true,
      confirm: t("保存"),
    });
    if (!name) return;
    if (rename && selected)
      await save({ kind: "rename", id: selected.id, name });
    else {
      const next = await save({ kind: "create", name, style: draft });
      if (next) setPresetId(next.presets.at(-1)!.id);
    }
  }
  function choice<K extends keyof ReadingStyle>(
    key: K,
    label: string,
    values: [ReadingStyle[K], string][],
  ) {
    return (
      <div className="reader-setting">
        <span>{label}</span>
        <Select
          aria-label={label}
          value={String(draft[key])}
          onValueChange={(value) => set(key, value as ReadingStyle[K])}
        >
          {values.map(([value, label]) => (
            <option key={String(value)} value={String(value)}>
              {label}
            </option>
          ))}
        </Select>
      </div>
    );
  }
  function number(key: keyof typeof readingRanges, label: string) {
    return (
      <label className="reader-setting">
        <span>{label}</span>
        <input
          type="number"
          {...readingRanges[key]}
          required
          value={Number.isFinite(draft[key]) ? draft[key] : ""}
          onChange={(event) => set(key, event.currentTarget.valueAsNumber)}
        />
      </label>
    );
  }
  function check(
    key: "hideSidebars" | "justify" | "numberHeadings",
    label: string,
  ) {
    return (
      <label className="reader-check">
        <input
          type="checkbox"
          checked={draft[key]}
          onChange={(event) => set(key, event.currentTarget.checked)}
        />
        {label}
      </label>
    );
  }
  const valid = Object.keys(readingRanges).every((name) => {
    const key = name as keyof typeof readingRanges;
    if (
      (key === "textWidth" && draft.widthMode !== "limited") ||
      (key === "pageGap" && draft.layout !== "paged")
    )
      return true;
    return (
      draft[key] >= readingRanges[key].min &&
      draft[key] <= readingRanges[key].max
    );
  });
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(value.style);
        setOpen(next);
      }}
    >
      <Popover.Trigger asChild>
        <button
          className="reader-settings-ball"
          type="button"
          aria-label={t("阅读设置")}
          title={t("阅读设置")}
        >
          <SlidersHorizontal size={20} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          side="top"
          sideOffset={10}
          collisionPadding={12}
          className="reader-settings-panel"
          aria-label={t("阅读设置")}
        >
          <header>
            <strong>{t("阅读设置")}</strong>
            <Popover.Close
              className="icon-button"
              aria-label={t("关闭阅读设置")}
            >
              <X size={16} />
            </Popover.Close>
          </header>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (valid && !saving) void save({ kind: "style", style: draft });
            }}
          >
            <div className="reader-settings-fields">
              {choice("layout", t("阅读方式"), [
                ["paged", t("翻页模式")],
                ["scroll", t("滚动模式")],
              ])}
              {!comic &&
                draft.layout === "paged" &&
                choice("bookSpread", t("书籍翻页布局"), [
                  ["auto", t("随阅读区宽度")],
                  ["single", t("单页")],
                  ["double", t("双页")],
                ])}
              {choice("widthMode", t("阅读区宽度"), [
                ["fit", t("铺满可用宽度")],
                ["limited", t("限制页面宽度")],
              ])}
              {draft.widthMode === "limited" &&
                number(
                  "textWidth",
                  draft.layout === "paged"
                    ? t("单页宽度（px）")
                    : t("正文宽度（px）"),
                )}
              {number("pageMarginInline", t("左右留白（px）"))}
              {number("pageMarginBlock", t("上下留白（px）"))}
              {draft.layout === "paged" && number("pageGap", t("页间距（px）"))}
              {choice("font", t("阅读字体"), [
                ["system", t("系统字体")],
                ["serif", t("衬线字体")],
                ["mono", t("等宽字体")],
              ])}
              {number("fontSize", t("阅读字号（px）"))}
              {number("lineHeight", t("阅读行距"))}
              {number("paragraphSpacing", t("段落间距（em）"))}
              {number("firstLineIndent", t("正文首行缩进（em）"))}
              {comic &&
                choice("comicFit", t("漫画图片适应"), [
                  ["contain", t("完整显示")],
                  ["width", t("适应宽度")],
                ])}
              {comic &&
                choice("comicSpread", t("漫画翻页布局"), [
                  ["single", t("单页")],
                  ["double", t("双页")],
                ])}
              {comic &&
                choice("comicDirection", t("漫画翻页方向"), [
                  ["ltr", t("从左到右")],
                  ["rtl", t("从右到左")],
                ])}
            </div>
            <div className="reader-checks">
              {check("hideSidebars", t("隐藏侧边栏"))}
              {check("justify", t("正文两端对齐"))}
              {!comic && check("numberHeadings", t("显示章节编号"))}
            </div>
            <div className="reader-settings-actions">
              <button
                type="button"
                className="button small"
                disabled={saving}
                onClick={() => setDraft(defaultReadingStyle)}
              >
                {t("恢复默认")}
              </button>
              <button
                type="submit"
                className="button small primary"
                disabled={!valid || saving}
              >
                {t("应用阅读设置")}
              </button>
            </div>
          </form>
          <div className="reader-presets">
            <strong>
              {t("阅读预设")}{" "}
              <span>
                {value.presets.length}/{maxReadingPresets}
              </span>
            </strong>
            <Select
              aria-label={t("阅读预设")}
              value={selected?.id ?? ""}
              disabled={saving}
              onValueChange={setPresetId}
            >
              <option value="">{t("选择阅读预设")}</option>
              {value.presets.map(({ id, name }) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </Select>
            <div className="reader-settings-actions">
              <button
                className="button small"
                disabled={!selected || saving}
                onClick={() =>
                  selected && void save({ kind: "apply", id: selected.id })
                }
              >
                {t("应用预设")}
              </button>
              <button
                className="button small"
                disabled={!selected || !valid || saving}
                onClick={() =>
                  selected &&
                  void save({ kind: "update", id: selected.id, style: draft })
                }
              >
                {t("更新预设")}
              </button>
              <button
                className="button small"
                disabled={!selected || saving}
                onClick={() => void namePreset(true)}
              >
                {t("重命名")}
              </button>
              <button
                className="button small"
                disabled={!selected || saving}
                onClick={() =>
                  selected && void save({ kind: "remove", id: selected.id })
                }
              >
                {t("删除")}
              </button>
              <button
                className="button small"
                disabled={full || !valid || saving}
                onClick={() => void namePreset(false)}
              >
                {t("保存为阅读预设")}
              </button>
            </div>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
