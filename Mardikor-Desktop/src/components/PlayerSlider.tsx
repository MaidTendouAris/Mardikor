import {
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

export function PlayerSlider({
  label,
  value,
  valueText,
  max,
  step,
  disabled = false,
  onChange,
  onHover,
}: {
  label: string;
  value: number;
  valueText: string;
  max: number;
  step: number;
  disabled?: boolean;
  onChange: (value: number) => void;
  onHover?: (fraction: number | null) => void;
}) {
  const track = useRef<HTMLSpanElement>(null);
  const [dragging, setDragging] = useState(false);

  function update(value: number) {
    if (value >= max) onChange(max);
    else onChange(Math.max(0, Math.min(max, Math.round(value / step) * step)));
  }

  function pointerFraction(event: PointerEvent<HTMLSpanElement>) {
    const bounds = track.current?.getBoundingClientRect();
    if (bounds?.width)
      return Math.max(
        0,
        Math.min(1, (event.clientX - bounds.left) / bounds.width),
      );
  }

  function updateFromPointer(event: PointerEvent<HTMLSpanElement>) {
    const fraction = pointerFraction(event);
    if (fraction !== undefined) update(fraction * max);
  }

  function adjustWithKeyboard(event: KeyboardEvent<HTMLSpanElement>) {
    if (disabled) return;
    let next: number;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowUp":
        next = value + step;
        break;
      case "ArrowLeft":
      case "ArrowDown":
        next = value - step;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = max;
        break;
      case "PageUp":
        next = value + max / 10;
        break;
      case "PageDown":
        next = value - max / 10;
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    update(next);
  }

  return (
    <span
      className="player-slider"
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled || undefined}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={valueText}
      data-dragging={dragging || undefined}
      onKeyDown={adjustWithKeyboard}
      onPointerDown={(event) => {
        if (disabled || event.button !== 0 || !event.isPrimary) return;
        event.preventDefault();
        event.currentTarget.focus({ preventScroll: true });
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
        updateFromPointer(event);
      }}
      onPointerMove={(event) => {
        if (disabled) return;
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          updateFromPointer(event);
        if (event.pointerType !== "touch")
          onHover?.(pointerFraction(event) ?? null);
      }}
      onPointerLeave={() => onHover?.(null)}
      onLostPointerCapture={() => setDragging(false)}
    >
      <span
        ref={track}
        className="player-slider-track"
        style={
          { "--slider-position": `${(value / max) * 100}%` } as CSSProperties
        }
        aria-hidden="true"
      />
    </span>
  );
}
