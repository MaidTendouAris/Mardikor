import { useEffect, useState } from "react";
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
  const [value, setValue] = useState(current);
  useEffect(() => setValue(current), [current, count]);
  const unavailable = disabled || count < 2;
  return (
    <nav className="page-navigation" aria-label="翻页">
      <button
        type="button"
        className="button small page-navigation-arrow"
        aria-label="上一页"
        title="上一页"
        disabled={unavailable || page === 0}
        onClick={() => onPage(page - 1)}
      >
        <ChevronLeft size={14} aria-hidden="true" />
        <span>上一页</span>
      </button>
      <form
        className="page-jump"
        onSubmit={(event) => {
          event.preventDefault();
          const index = Number(value) - 1;
          if (
            !unavailable &&
            Number.isSafeInteger(index) &&
            index >= 0 &&
            index < count
          )
            onPage(index);
        }}
      >
        <input
          aria-label="页码"
          type="number"
          min={1}
          max={count || undefined}
          placeholder="—"
          disabled={unavailable}
          required
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        <span>/ {count || "—"}</span>
        <button
          className="button small page-navigation-go"
          type="submit"
          aria-label="跳转"
          title="跳转"
          disabled={unavailable}
        >
          <CornerDownLeft size={13} aria-hidden="true" />
          <span>跳转</span>
        </button>
      </form>
      <button
        type="button"
        className="button small page-navigation-arrow"
        aria-label="下一页"
        title="下一页"
        disabled={unavailable || page + 1 >= count}
        onClick={() => onPage(page + 1)}
      >
        <ChevronRight size={14} aria-hidden="true" />
        <span>下一页</span>
      </button>
    </nav>
  );
}
