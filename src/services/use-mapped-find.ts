import { useLayoutEffect, useRef } from "react";
import {
  createFindMapper,
  mapFindLocation,
  type FindLocation,
} from "./find-mapping";

function findHighlight(active: boolean) {
  const name = active
    ? "mardikor-document-find"
    : "mardikor-document-find-matches";
  let highlight = CSS.highlights.get(name);
  if (!highlight) {
    highlight = new Highlight();
    highlight.priority = active ? 1 : 0;
    CSS.highlights.set(name, highlight);
  }
  return highlight;
}

function marker(node: HTMLElement, range?: Range) {
  const media = range?.startContainer.childNodes[range.startOffset];
  return media instanceof HTMLElement ? media : node;
}

export function useMappedMatches(
  root: React.RefObject<HTMLElement | null>,
  source: string,
  locations: readonly FindLocation[],
  rendered: unknown,
  rich = false,
) {
  useLayoutEffect(() => {
    if (!root.current || !rendered || !locations.length) return;
    const body = root.current;
    const highlight = findHighlight(false);
    const ranges: Range[] = [];
    const anchors = new Set<HTMLElement>();
    let map: ReturnType<typeof createFindMapper> | undefined;
    let index = 0;
    function paint() {
      if (!body.isConnected) return;
      map ??= createFindMapper(body, source, rich);
      const deadline = performance.now() + 8;
      do {
        const match = map(locations[index++]);
        const target = match.ranges[0];
        if (target?.toString()) {
          for (const range of match.ranges) {
            ranges.push(range);
            highlight.add(range);
          }
        } else {
          const anchor = marker(match.node, target);
          if (!anchors.has(anchor)) {
            anchors.add(anchor);
            anchor.setAttribute("data-document-find-match", "");
          }
        }
      } while (index < locations.length && performance.now() < deadline);
      if (index < locations.length) frame = requestAnimationFrame(paint);
      else map = undefined;
    }
    let frame = requestAnimationFrame(paint);
    return () => {
      cancelAnimationFrame(frame);
      for (const range of ranges) highlight.delete(range);
      for (const anchor of anchors)
        anchor.removeAttribute("data-document-find-match");
    };
  }, [root, source, locations, rendered, rich]);
}

export function useMappedFind(
  root: React.RefObject<HTMLElement | null>,
  source: string,
  location: FindLocation | undefined,
  rendered: unknown,
  reveal: (rect: DOMRect, anchor: HTMLElement) => void,
  rich = false,
) {
  const scroll = useRef(reveal);
  scroll.current = reveal;
  useLayoutEffect(() => {
    if (!location || !root.current || !rendered) return;
    const body = root.current;
    const highlight = findHighlight(true);
    let ranges: Range[] = [];
    let anchor: HTMLElement | undefined;
    function mark() {
      if (!body.isConnected) return;
      const mapped = mapFindLocation(body, source, location!, rich);
      const { node } = mapped;
      ranges = mapped.ranges;
      const target = ranges[0];
      if (target?.toString()) {
        for (const range of ranges) highlight.add(range);
        const rect = target.getClientRects()[0] ?? node.getBoundingClientRect();
        scroll.current(rect, node);
      } else {
        anchor = marker(node, target);
        anchor.setAttribute("data-document-find-anchor", "");
        scroll.current(anchor.getBoundingClientRect(), anchor);
      }
    }
    const frame = requestAnimationFrame(mark);
    return () => {
      cancelAnimationFrame(frame);
      anchor?.removeAttribute("data-document-find-anchor");
      for (const range of ranges) highlight.delete(range);
    };
  }, [root, source, location, rendered, rich]);
}

export function revealFindRect(viewport: HTMLElement, rect: DOMRect) {
  const bounds = viewport.getBoundingClientRect();
  if (rect.top < bounds.top + 8 || rect.bottom > bounds.bottom - 8)
    viewport.scrollTop += rect.top - bounds.top - viewport.clientHeight / 3;
}
