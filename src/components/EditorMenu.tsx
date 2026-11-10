import { t } from "../../shared/i18n";
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
export interface EditorMenuItem {
  id: string;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  separator?: boolean;
  run: () => void;
}
export function EditorMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: EditorMenuItem[];
  onClose: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = menu.current!;
    const box = node.getBoundingClientRect();
    node.style.left =
      Math.max(8, Math.min(x, window.innerWidth - box.width - 8)) + "px";
    node.style.top =
      Math.max(8, Math.min(y, window.innerHeight - box.height - 8)) + "px";
    const pointer = (event: PointerEvent) => {
      if (!node.contains(event.target as Node)) onClose();
    };
    const scroll = (event: Event) => {
      if (!node.contains(event.target as Node)) onClose();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        const buttons = [
          ...node.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
        ];
        const current = buttons.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        const index =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? buttons.length - 1
              : current < 0
                ? event.key === "ArrowDown"
                  ? 0
                  : buttons.length - 1
                : (current +
                    (event.key === "ArrowDown" ? 1 : -1) +
                    buttons.length) %
                  buttons.length;
        buttons[index]?.focus({ preventScroll: true });
      }
    };
    window.addEventListener("pointerdown", pointer, true);
    window.addEventListener("keydown", key, true);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("pointerdown", pointer, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", onClose);
    };
  }, [x, y, onClose]);
  return createPortal(
    <div
      className="editor-context-menu"
      ref={menu}
      role="menu"
      aria-label={t("正文右键菜单")}
      style={{ left: x, top: y }}
    >
      {items.map((item) => (
        <div key={item.id}>
          {item.separator && <div role="separator" />}
          <button
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              onClose();
              item.run();
            }}
          >
            <span>{item.label}</span>
            {item.shortcut && <kbd>{item.shortcut}</kbd>}
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}

export function EditorDialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);
  return createPortal(
    <dialog
      ref={ref}
      className="editor-dialog"
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="editor-dialog-title">
        <strong>{title}</strong>
        <button
          className="icon-button"
          aria-label={t("关闭对话框")}
          onClick={onClose}
        >
          ×
        </button>
      </div>
      {children}
    </dialog>,
    document.body,
  );
}
