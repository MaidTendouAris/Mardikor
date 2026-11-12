import { ChevronDown, ChevronUp, Settings2, X } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { t } from "../../shared/i18n";
import type { FindScope } from "../services/document-find";
import type { useSourceFind } from "../services/use-source-find";
import "../styles/document-find.css";

const scopes = [
  { value: "document", label: "当前文档" },
  { value: "branch", label: "当前文档及其子文档" },
  { value: "project", label: "全部文档" },
] as const satisfies readonly { value: FindScope; label: string }[];

export function DocumentFindBar({
  find,
  focus,
  close,
}: {
  find: ReturnType<typeof useSourceFind>;
  focus: number;
  close: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const jumpInput = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const id = useId();
  const [settings, setSettings] = useState(false);
  const [number, setNumber] = useState<string>();
  const currentNumber = find.active < 0 ? "" : String(find.active + 1);
  useLayoutEffect(
    () => setNumber(undefined),
    [find.active, find.total, find.query],
  );
  useLayoutEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [focus]);
  const status = !find.query
    ? ""
    : find.error
      ? "!"
      : find.pending
        ? "…"
        : t("{0} / {1}", find.active + 1, find.total);
  const statusLabel = find.error
    ? t("无法计算查找结果")
    : find.pending
      ? t("正在查找…")
      : find.query && !find.total
        ? t("无匹配结果")
        : undefined;
  return (
    <div
      className="document-find-bar"
      role="search"
      aria-label={t("文档查找")}
      onKeyDown={(event) => {
        if (
          composing.current ||
          event.nativeEvent.isComposing ||
          event.keyCode === 229
        )
          return;
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          if (settings) {
            setSettings(false);
            input.current?.focus();
          } else close();
        } else if (event.key === "Enter" && event.target === input.current) {
          event.preventDefault();
          find.step(event.shiftKey ? -1 : 1);
        } else if (
          event.key === "Enter" &&
          event.target === jumpInput.current
        ) {
          event.preventDefault();
          find.jump(Number(number ?? currentNumber) - 1);
          setNumber(undefined);
        }
      }}
    >
      <input
        ref={input}
        className="document-find-input document-find-query"
        aria-label={t("查找文字")}
        value={find.query}
        onChange={(event) => find.setQuery(event.currentTarget.value)}
        onCompositionStart={() => {
          composing.current = true;
          find.setComposition(true);
        }}
        onCompositionEnd={() => {
          composing.current = false;
          find.setComposition(false);
        }}
        spellCheck={false}
      />
      <span className="document-find-count" title={statusLabel}>
        {find.total > 0 ? (
          <>
            <span className="document-find-sr-only" role="status">
              {status}
            </span>
            <input
              ref={jumpInput}
              className="document-find-input document-find-number"
              aria-label={t("跳转到匹配项")}
              title={t("跳转到匹配项")}
              inputMode="numeric"
              placeholder="0"
              size={Math.max(3, String(find.total).length)}
              value={number ?? currentNumber}
              onChange={(event) =>
                setNumber(event.currentTarget.value.replace(/\D/g, ""))
              }
              onBlur={() => setNumber(undefined)}
            />
            <span aria-hidden="true"> / {find.total}</span>
          </>
        ) : (
          <span role="status" aria-label={statusLabel}>
            {status}
          </span>
        )}
      </span>
      {(
        [
          [-1, "上一个匹配项", ChevronUp],
          [1, "下一个匹配项", ChevronDown],
        ] as const
      ).map(([direction, label, Icon]) => (
        <button
          key={direction}
          type="button"
          className="icon-button"
          aria-label={t(label)}
          title={t(label)}
          onMouseDown={(event) => event.preventDefault()}
          disabled={!find.total}
          onClick={() => find.step(direction)}
        >
          <Icon size={16} />
        </button>
      ))}
      <button
        type="button"
        className="icon-button"
        aria-label={t("查找设置")}
        title={t("查找设置")}
        aria-expanded={settings}
        aria-controls={settings ? id : undefined}
        onClick={() => setSettings(!settings)}
      >
        <Settings2 size={16} />
      </button>
      {settings && (
        <div className="document-find-settings" id={id}>
          <fieldset>
            <legend>{t("查找范围")}</legend>
            {scopes.map(({ value, label }) => (
              <label key={value}>
                <input
                  type="radio"
                  name={id}
                  checked={find.options.scope === value}
                  onChange={() =>
                    find.changeOptions({ ...find.options, scope: value })
                  }
                />
                {t(label)}
              </label>
            ))}
          </fieldset>
          <label className="document-find-case">
            <input
              type="checkbox"
              checked={find.options.matchCase}
              onChange={(event) =>
                find.changeOptions({
                  ...find.options,
                  matchCase: event.currentTarget.checked,
                })
              }
            />
            {t("区分大小写")}
          </label>
        </div>
      )}
      <button
        type="button"
        className="icon-button"
        aria-label={t("关闭查找")}
        title={t("关闭查找")}
        onClick={close}
      >
        <X size={16} />
      </button>
    </div>
  );
}
