import { t } from "../../shared/i18n";
import { useEffect, useId, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown } from "lucide-react";

export function FontCombobox({
  value,
  options,
  disabled,
  onValueChange,
  "aria-label": label,
}: {
  value: string;
  options: string[];
  disabled: boolean;
  onValueChange: (value: string) => void;
  "aria-label": string;
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(""),
    [active, setActive] = useState(-1);
  const input = useRef<HTMLInputElement>(null),
    anchor = useRef<HTMLSpanElement>(null),
    list = useRef<HTMLDivElement>(null),
    listId = useId();
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  const allChoices = [...new Set(options)];
  const choices = allChoices.filter((option) =>
    option.toLowerCase().includes(query.toLowerCase()),
  );
  useEffect(() => {
    if (open && active >= 0)
      list.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [active, open]);
  const choose = (value: string) => {
    onValueChange(value);
    setOpen(false);
    input.current?.focus();
  };
  return (
    <Popover.Root open={open && !disabled} onOpenChange={setOpen}>
      <Popover.Anchor asChild>
        <span className="font-combobox" ref={anchor}>
          <input
            ref={input}
            aria-label={label}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open && !disabled}
            aria-controls={listId}
            aria-activedescendant={
              open && active >= 0 ? listId + "-" + active : undefined
            }
            value={value}
            disabled={disabled}
            onBlur={() => setOpen(false)}
            onChange={(event) => {
              onValueChange(event.target.value);
              setQuery(event.target.value);
              setActive(-1);
              setOpen(true);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                if (!open) {
                  setQuery("");
                  setOpen(true);
                  setActive(
                    event.key === "ArrowDown" ? 0 : allChoices.length - 1,
                  );
                } else
                  setActive((index) =>
                    choices.length
                      ? index < 0
                        ? event.key === "ArrowDown"
                          ? 0
                          : choices.length - 1
                        : (index +
                            (event.key === "ArrowDown" ? 1 : -1) +
                            choices.length) %
                          choices.length
                      : -1,
                  );
              } else if (event.key === "Enter" && open) {
                event.preventDefault();
                if (choices[active]) choose(choices[active]);
                else setOpen(false);
              } else if (event.key === "Escape" && open) {
                event.preventDefault();
                event.stopPropagation();
                setOpen(false);
              } else if (event.key === "Tab") setOpen(false);
            }}
          />
          <button
            type="button"
            aria-label={t("选择字体")}
            disabled={disabled}
            aria-expanded={open && !disabled}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              setQuery("");
              setActive(allChoices.indexOf(value));
              setOpen(!open);
              input.current?.focus();
            }}
          >
            <ChevronDown size={14} />
          </button>
        </span>
      </Popover.Anchor>
      <Popover.Portal
        container={anchor.current?.closest("dialog") ?? undefined}
      >
        <Popover.Content
          ref={list}
          role="listbox"
          id={listId}
          aria-label={t("字体建议")}
          className="select-content font-options"
          align="start"
          sideOffset={4}
          collisionPadding={8}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onInteractOutside={(event) => {
            if (anchor.current?.contains(event.target as Node))
              event.preventDefault();
          }}
        >
          {choices.map((option, index) => (
            <div
              key={option}
              role="option"
              aria-selected={index === active}
              id={listId + "-" + index}
              data-value={option}
              className="select-option"
              data-highlighted={index === active ? "" : undefined}
              onPointerMove={() => setActive(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(option)}
            >
              <span>{option}</span>
              {option === value && <Check size={14} className="select-check" />}
            </div>
          ))}
          {!choices.length && (
            <div className="select-empty">
              {t("无匹配项，可直接输入字体名称")}
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
