import { useEffect, useId, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown, Search } from "lucide-react";
import { t } from "../../shared/i18n";
import {
  systemFontName,
  systemFontReference,
  type SystemFont,
} from "../../shared/fonts";

function searchText(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase();
}

export function FontCombobox({
  value,
  options,
  disabled,
  onValueChange,
  "aria-label": label,
}: {
  value: string;
  options: [string, string][];
  disabled?: boolean;
  onValueChange: (value: string) => void;
  "aria-label": string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);
  const [systemFonts, setSystemFonts] = useState<SystemFont[]>([]);
  const [loading, setLoading] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open || disabled) return;
    let live = true;
    setLoading(true);
    void (window.mardikor?.systemFonts() ?? Promise.resolve([]))
      .then(
        (fonts) => {
          if (live)
            setSystemFonts(
              [...fonts].sort((a, b) => a.fullName.localeCompare(b.fullName)),
            );
        },
        () => {
          if (live) setSystemFonts([]);
        },
      )
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [open, disabled]);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const installed = systemFonts.map((font) => ({
    value: systemFontReference(font.postscriptName),
    title: font.fullName || font.family || font.postscriptName,
    search: `${font.fullName} ${font.family} ${font.postscriptName}`,
    system: true,
  }));
  const all = [
    ...options.map(([value, title]) => ({
      value,
      title,
      search: `${title} ${value}`,
      system: false,
    })),
    ...installed,
  ];
  const selected = all.find((item) => item.value === value);
  const selectedName = selected?.title ?? systemFontName(value) ?? value;
  const terms = searchText(query.trim()).split(/\s+/);
  const shown = all.filter(({ search }) =>
    terms.every((term) => searchText(search).includes(term)),
  );
  useEffect(() => {
    if (open && active >= 0)
      document
        .getElementById(`${listId}-${active}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [open, active, listId]);

  function choose(option: string) {
    onValueChange(option);
    setOpen(false);
  }
  return (
    <Popover.Root
      open={open && !disabled}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setQuery("");
          setActive(-1);
        }
      }}
    >
      <Popover.Trigger asChild>
        <button
          ref={trigger}
          type="button"
          role="combobox"
          aria-label={label}
          aria-haspopup="listbox"
          aria-controls={open ? listId : undefined}
          data-value={value}
          disabled={disabled}
          className="custom-select-trigger font-trigger"
          title={selectedName}
        >
          <span>{selectedName}</span>
          <ChevronDown size={14} className="select-chevron" />
        </button>
      </Popover.Trigger>
      <Popover.Portal
        container={trigger.current?.closest("dialog") ?? undefined}
      >
        <Popover.Content
          className="select-content font-options"
          align="start"
          sideOffset={4}
          collisionPadding={8}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            input.current?.focus();
          }}
        >
          <div className="font-search">
            <Search size={16} aria-hidden="true" />
            <input
              ref={input}
              type="search"
              value={query}
              aria-label={t("搜索字体")}
              placeholder={t("搜索字体")}
              aria-controls={listId}
              aria-activedescendant={
                shown[active] ? `${listId}-${active}` : undefined
              }
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  if (shown.length)
                    setActive((index) =>
                      index < 0
                        ? event.key === "ArrowDown"
                          ? 0
                          : shown.length - 1
                        : (index +
                            (event.key === "ArrowDown" ? 1 : -1) +
                            shown.length) %
                          shown.length,
                    );
                } else if (event.key === "Enter" && shown[active]) {
                  event.preventDefault();
                  choose(shown[active].value);
                }
              }}
            />
          </div>
          <div
            id={listId}
            role="listbox"
            aria-label={label}
            className="font-results"
          >
            {shown.map((option, index) => (
              <div key={option.value}>
                {option.system && !shown[index - 1]?.system && (
                  <div className="font-catalog-label">{t("系统字体")}</div>
                )}
                <button
                  id={`${listId}-${index}`}
                  type="button"
                  role="option"
                  tabIndex={-1}
                  aria-selected={option.value === value}
                  data-value={option.value}
                  data-highlighted={index === active ? "" : undefined}
                  className="select-option"
                  onPointerMove={() => setActive(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(option.value)}
                >
                  <span>{option.title}</span>
                  {option.value === value && (
                    <Check size={14} className="select-check" />
                  )}
                </button>
              </div>
            ))}
          </div>
          {loading ? (
            <div className="select-empty" role="status">
              {t("正在读取系统字体…")}
            </div>
          ) : (
            !shown.length && (
              <div className="select-empty" role="status">
                {t("没有匹配的字体")}
              </div>
            )
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
