import { useEffect, useId, useRef, useState } from "react";
import { t } from "../../shared/i18n";
import { keyboardComposing } from "../../shared/shortcuts";
import { EditorDialog } from "./EditorMenu";

export interface MarkdownAction {
  id: string;
  label: string;
  example: string;
  terms: readonly string[];
  alias?: string;
  shortcut?: string;
  disabled?: boolean;
  run: () => void;
}

export function MarkdownActions({
  actions,
  onClose,
}: {
  actions: MarkdownAction[];
  onClose: () => void;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string>();
  const composing = useRef(false);
  const option = useRef<HTMLButtonElement>(null);
  const search = query.trim().toLowerCase();
  const alias = actions.find((action) => action.alias === search);
  const matches = alias
    ? [alias]
    : actions.filter((action) =>
        search
          .split(/\s+/)
          .every((word) =>
            [action.label, ...action.terms].some((term) =>
              term.toLowerCase().includes(word),
            ),
          ),
      );
  const available = matches.filter((action) => !action.disabled);
  const current = available.find((a) => a.id === selected) ?? available[0];
  const optionId = (action: MarkdownAction) => `${id}-${action.id}`;
  useEffect(() => {
    option.current?.scrollIntoView({ block: "nearest" });
  }, [current?.id]);
  return (
    <EditorDialog
      title={t("Markdown 操作")}
      initialFocus="input"
      onClose={() => {
        if (!composing.current) onClose();
      }}
    >
      <input
        autoFocus
        type="search"
        role="combobox"
        aria-label={t("搜索 Markdown 操作")}
        placeholder={t("搜索 Markdown 操作")}
        aria-expanded="true"
        aria-controls={id}
        aria-autocomplete="list"
        aria-activedescendant={current && optionId(current)}
        value={query}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setSelected(undefined);
        }}
        onKeyDown={(event) => {
          if (
            composing.current ||
            keyboardComposing(event.nativeEvent) ||
            event.getModifierState("AltGraph")
          )
            return;
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          } else if (event.key === "Enter") {
            event.preventDefault();
            if (!event.repeat) current?.run();
          } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (!available.length) return;
            const index = current ? available.indexOf(current) : 0;
            const offset = event.key === "ArrowDown" ? 1 : -1;
            setSelected(
              available[(index + offset + available.length) % available.length]
                ?.id,
            );
          }
        }}
      />
      <div
        className="markdown-actions-list"
        role="listbox"
        id={id}
        aria-label={t("Markdown 操作")}
      >
        {matches.map((action) => (
          <button
            key={action.id}
            id={optionId(action)}
            type="button"
            role="option"
            tabIndex={-1}
            aria-selected={action === current}
            aria-disabled={action.disabled || undefined}
            ref={action === current ? option : undefined}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              if (!action.disabled) action.run();
            }}
          >
            <span>{action.label}</span>
            {(action.shortcut || action.alias) && (
              <kbd>{action.shortcut ?? action.alias!.toUpperCase()}</kbd>
            )}
            <code>{action.example}</code>
          </button>
        ))}
      </div>
      {!matches.length && (
        <p role="status" className="field-hint">
          {t("没有匹配的 Markdown 操作。")}
        </p>
      )}
    </EditorDialog>
  );
}
