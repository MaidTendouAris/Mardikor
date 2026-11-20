import type { KeyboardEvent } from "react";

export function navigateTabs(event: KeyboardEvent<HTMLDivElement>) {
  if (
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
  )
    return;
  const tabs = Array.from(
    event.currentTarget.querySelectorAll<HTMLButtonElement>(
      'button[role="tab"]:enabled',
    ),
  );
  const current = tabs.indexOf(event.target as HTMLButtonElement);
  if (current < 0) return;
  let index = current;
  switch (event.key) {
    case "ArrowLeft":
      index = (current + tabs.length - 1) % tabs.length;
      break;
    case "ArrowRight":
      index = (current + 1) % tabs.length;
      break;
    case "Home":
      index = 0;
      break;
    case "End":
      index = tabs.length - 1;
      break;
  }
  event.preventDefault();
  const next = tabs[index];
  next.focus();
  if (next.getAttribute("aria-selected") !== "true") next.click();
}
