import type { MouseEvent } from "react";
import { resolveReference } from "../../shared/references";
import { desktop } from "./desktop";

export function findPreviewFragment(root: ParentNode, fragment: string) {
  let id = fragment;
  try {
    id = decodeURIComponent(fragment);
  } catch {
    /* Keep literal fragments. */
  }
  return Array.from(root.querySelectorAll<HTMLElement>("[id]")).find(
    (node) =>
      node.id === id ||
      node.dataset.fragment === id ||
      node.id.endsWith(`-${id}`),
  );
}

export function scrollToFragment(root: ParentNode, fragment: string) {
  const target = findPreviewFragment(root, fragment);
  target?.scrollIntoView({ block: "start" });
  return !!target;
}

export function followPreviewLink(
  event: MouseEvent<HTMLElement>,
  source: string,
  standalone: boolean,
  openFile: (path: string) => void,
  onError: (error: string) => void,
) {
  const anchor = (event.target as Element).closest<HTMLAnchorElement>("a");
  if (!anchor) return;
  event.preventDefault();
  const href = anchor.dataset.mdkLink ?? anchor.getAttribute("href") ?? "";
  if (!href || href === "#") return;
  const root = anchor.closest("article") ?? event.currentTarget;
  if (href.startsWith("#")) {
    scrollToFragment(root, href.slice(1));
    return;
  }
  const target = resolveReference(source, href);
  if (target.kind === "external") {
    void desktop()
      .openExternal(target.url)
      .catch((error) => onError(String(error)));
  } else if (standalone) {
    void desktop()
      .openMarkdownLink(href)
      .catch((error) => onError(String(error)));
  } else if (target.kind === "local") {
    if (target.path === source && target.suffix.startsWith("#"))
      scrollToFragment(root, target.suffix.slice(1));
    else openFile(target.path);
  }
}
