import { t } from "../../shared/i18n";
import type { RefObject } from "react";

export function SplitHandle({
  axis,
  label,
  value,
  onChange,
  container,
}: {
  axis: "horizontal" | "vertical";
  label: string;
  value: number;
  onChange: (value: number) => void;
  container: RefObject<HTMLElement | null>;
}) {
  const clamp = (v: number) => Math.max(0.2, Math.min(0.8, v));
  return (
    <div
      className={`split-handle split-${axis}`}
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={axis}
      aria-valuemin={20}
      aria-valuemax={80}
      aria-valuenow={Math.round(value * 100)}
      title={t("拖动调整大小，双击恢复均分")}
      onDoubleClick={() => onChange(0.5)}
      onKeyDown={(event) => {
        const backward = axis === "horizontal" ? "ArrowUp" : "ArrowLeft";
        const forward = axis === "horizontal" ? "ArrowDown" : "ArrowRight";
        if (![backward, forward, "Home", "End", "Enter"].includes(event.key))
          return;
        event.preventDefault();
        onChange(
          event.key === "Home"
            ? 0.2
            : event.key === "End"
              ? 0.8
              : event.key === "Enter"
                ? 0.5
                : clamp(value + (event.key === backward ? -0.05 : 0.05)),
        );
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const box = container.current?.getBoundingClientRect();
        if (!box) return;
        onChange(
          clamp(
            axis === "horizontal"
              ? (event.clientY - box.top) / box.height
              : (event.clientX - box.left) / box.width,
          ),
        );
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      }}
    />
  );
}
