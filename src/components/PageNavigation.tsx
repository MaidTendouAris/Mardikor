import { t } from "../../shared/i18n";
import { useState } from "react";
import { ChevronLeft, ChevronRight, CornerDownLeft } from "lucide-react";

export function PageNavigation({
  page,
  count,
  disabled,
  onPage,
}: {
  page: number;
  count: number;
  disabled: boolean;
  onPage: (page: number) => void;
}) {
  const current = count ? String(page + 1) : "";
  const [draft, setDraft] = useState<string>();
  const value = draft ?? current;
  const unavailable = disabled || count < 2;
  return (
    <nav className="page-navigation" aria-label={t("翻页")}>
      <button
        type="button"
        className="button small page-navigation-arrow"
        aria-label={t("上一页")}
        title={t("上一页")}
        disabled={unavailable || page === 0}
        onClick={() => onPage(page - 1)}
      >
        <ChevronLeft size={14} aria-hidden="true" />
        <span>{t("上一页")}</span>
      </button>
      <form
        className="page-jump"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget))
            setDraft(undefined);
        }}
        onSubmit={(event) => {
          event.preventDefault();
          const index = Number(value) - 1;
          if (
            !unavailable &&
            Number.isSafeInteger(index) &&
            index >= 0 &&
            index < count
          ) {
            setDraft(undefined);
            onPage(index);
          }
        }}
      >
        <input
          aria-label={t("页码")}
          type="number"
          min={1}
          max={count || undefined}
          placeholder="—"
          disabled={unavailable}
          required
          value={value}
          onChange={(event) => setDraft(event.target.value)}
        />
        <span>/ {count || "—"}</span>
        <button
          className="button small page-navigation-go"
          type="submit"
          aria-label={t("跳转")}
          title={t("跳转")}
          disabled={unavailable}
        >
          <CornerDownLeft size={13} aria-hidden="true" />
          <span>{t("跳转")}</span>
        </button>
      </form>
      <button
        type="button"
        className="button small page-navigation-arrow"
        aria-label={t("下一页")}
        title={t("下一页")}
        disabled={unavailable || page + 1 >= count}
        onClick={() => onPage(page + 1)}
      >
        <ChevronRight size={14} aria-hidden="true" />
        <span>{t("下一页")}</span>
      </button>
    </nav>
  );
}
