import { t } from "../../shared/i18n";
import {
  forwardRef,
  Fragment,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { MarkdownHeading } from "../../shared/markdown";
import {
  headingOffsetAtLine,
  pageAtLine,
  type DocumentPages,
  type EditPageWindow,
} from "../services/document-pages";
import {
  followPreviewLink,
  scrollToFragment,
} from "../services/document-links";
import { markdownTask } from "../services/markdown-tasks";
import { previewPageArgs, type PreviewArgs } from "../services/preview-page";
import { findLocations, projectFindHit, type FindLocation } from "../services/find-mapping";
import { useMappedFind, useMappedMatches } from "../services/use-mapped-find";
import { lowerBound, type FindMatches, type SearchHit } from "../services/document-find";
type PageAnchor = { index: number; fraction: number };
export type PagePoint = {
  x: number;
  y: number;
  index: number;
  block?: number;
  textOffset?: number;
};
type PageEditor = {
  range?: EditPageWindow;
  content: ReactNode;
  activate: (index: number, point?: PagePoint) => void;
};
export interface PagedPreviewHandle {
  scrollTo: (ratio: number) => void;
  jump: (fragment: string) => void;
  showPage: (page: number) => void;
  revealFind: (rect: DOMRect) => void;
  preserve: () => void;
}

function pageAtOffset(offsets: number[], top: number) {
  let first = 0;
  let end = offsets.length - 1;
  while (first + 1 < end) {
    const middle = (first + end) >>> 1;
    if (offsets[middle] <= top) first = middle;
    else end = middle;
  }
  return first;
}

function pageBlocks(root: HTMLElement, index: number) {
  const holder = root.querySelector<HTMLElement>(".document-body");
  if (!holder)
    return Array.from(
      root.querySelector(".preview-body")?.children ?? [],
    ) as HTMLElement[];
  let page = Number(root.dataset.pageIndex);
  return Array.from(holder.children).filter(
    (element): element is HTMLElement => {
      const child = element as HTMLElement;
      if (child.dataset.editorPage !== undefined) {
        page = Number(child.dataset.editorPage);
        return false;
      }
      return page === index;
    },
  );
}

function clickPoint(
  root: HTMLElement,
  index: number,
  x: number,
  y: number,
): PagePoint {
  const point: PagePoint = { index, x, y };
  const caret = document.caretRangeFromPoint(x, y);
  if (!caret) return point;
  const blocks = pageBlocks(root, index);
  const block = blocks.findIndex((element) =>
    element.contains(caret.startContainer),
  );
  if (block < 0) return point;
  const text = document.createRange();
  text.selectNodeContents(blocks[block]);
  text.setEnd(caret.startContainer, caret.startOffset);
  if (blocks[block].querySelector(".container-label")) {
    const contents = text.cloneContents();
    contents.querySelectorAll(".container-label").forEach((label) => label.remove());
    return { ...point, block, textOffset: contents.textContent?.length ?? 0 };
  }
  return { ...point, block, textOffset: text.toString().length };
}

function PreviewSlice({
  args,
  layout,
  index,
  headings,
  ready,
  resolveResource,
  find,
  matches,
  projectedMatches,
  revealFind,
}: {
  args: PreviewArgs;
  layout: DocumentPages;
  index: number;
  headings: { line: number; level: number }[];
  ready: (value: boolean) => void;
  resolveResource: (source: string) => Promise<string>;
  find?: FindLocation;
  matches?: FindMatches;
  projectedMatches?: FindLocation[];
  revealFind: (rect: DOMRect) => void;
}) {
  const renderArgs = useMemo(() => previewPageArgs(args, layout, index, headings),
    [args, layout, index, headings]);
  const [output, setOutput] = useState<{ args: PreviewArgs; html?: string; error?: string }>();
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const timer = setTimeout(() => {
      stop = markdownTask<string>(
        {
          kind: "preview",
          args: renderArgs,
        },
        (html) => setOutput({ args: renderArgs, html }),
        (error) => setOutput({ args: renderArgs, error }),
      );
    }, 80);
    let stop: (() => void) | undefined;
    return () => {
      clearTimeout(timer);
      stop?.();
    };
  }, [renderArgs]);
  useLayoutEffect(() => {
    ready(!!output);
    return () => ready(false);
  }, [!!output, ready]);
  useEffect(() => {
    let live = true;
    element.current
      ?.querySelectorAll<HTMLImageElement>("img[data-mdk-ref]")
      .forEach((image) => {
        void resolveResource(image.dataset.mdkRef ?? "").then(
          (src) => {
            if (live && src) image.src = src;
          },
          () => {
            if (live) image.alt += t("（资源不可用）");
          },
        );
      });
    return () => {
      live = false;
    };
  }, [output?.html, resolveResource]);
  useMappedFind(element, renderArgs[0], find, output?.args === renderArgs && output.html, revealFind);
  const locations = useMemo(() => {
    const page = layout.pages[index];
    const from = page.start;
    const to = layout.pages[index + 1]?.start ?? args[0].length + 1;
    const shift = (page.tableHeader?.length ?? 0) - from;
    if (!projectedMatches) return findLocations(matches, args[0], from, to, shift);
    const first = lowerBound(projectedMatches.length, (i) => projectedMatches[i].start >= from);
    const end = lowerBound(projectedMatches.length, (i) => projectedMatches[i].start >= to);
    return projectedMatches.slice(first, end).map((location) => ({
      ...location, start: location.start + shift, end: location.end + shift,
    }));
  }, [matches, projectedMatches, args[0], index, layout]);
  useMappedMatches(element, renderArgs[0], locations, output?.args === renderArgs && output.html);

  return output?.error ? (
    <p role="alert">{output.error}</p>
  ) : (
    <div
      ref={element}
      className="preview-body"
      dangerouslySetInnerHTML={{ __html: output?.html ?? "" }}
    />
  );
}

function PageSlice({
  args,
  layout,
  index,
  height,
  headings,
  showMarker,
  editor,
  zoom,
  onMeasure,
  onReady,
  resolveResource,
  find,
  matches,
  projectedMatches,
  revealFind,
}: {
  args: PreviewArgs;
  layout: DocumentPages;
  index: number;
  height: number;
  headings: { line: number; level: number }[];
  showMarker: boolean;
  editor?: PageEditor;
  zoom: number;
  onMeasure: (index: number, height: number) => void;
  onReady: (index: number) => void;
  resolveResource: (source: string) => Promise<string>;
  find?: FindLocation;
  matches?: FindMatches;
  projectedMatches?: FindLocation[];
  revealFind: (rect: DOMRect) => void;
}) {
  const node = useRef<HTMLDivElement>(null);
  const editing = editor?.range?.first === index && !!editor.content;
  const [ready, setReady] = useState(false);
  const measured = editing || ready;
  const activate =
    !editing && !layout.pages[index].readOnly ? editor?.activate : undefined;
  const measure = useCallback(() => {
    const root = node.current;
    if (!root) return;
    const bounds = root.getBoundingClientRect();
    let page = index,
      top = bounds.top;
    if (editing)
      for (const boundary of root.querySelectorAll<HTMLElement>(
        "[data-editor-page]",
      )) {
        const next = boundary.getBoundingClientRect().top;
        onMeasure(page, Math.max(1, (next - top) / zoom));
        page = Number(boundary.dataset.editorPage);
        top = next;
      }
    onMeasure(page, Math.max(1, (bounds.bottom - top) / zoom));
  }, [editing, index, onMeasure, zoom]);
  useLayoutEffect(() => {
    if (!measured || !node.current) return;
    const observer = new ResizeObserver(measure);
    observer.observe(node.current);
    return () => observer.disconnect();
  }, [measured, measure]);
  useLayoutEffect(() => {
    if (measured) measure();
  });
  useLayoutEffect(() => {
    if (measured) onReady(index);
  }, [measured, index, onReady]);
  return (
    <div
      ref={node}
      className="document-page"
      data-page-index={index}
      data-heading-offset={headingOffsetAtLine(
        headings,
        layout.pages[index].line,
      )}
      style={measured ? undefined : { minHeight: height }}
      aria-busy={!measured}
      tabIndex={activate && ready ? 0 : undefined}
      aria-label={activate && ready ? t("编辑第 {0} 页", index + 1) : undefined}
      onMouseDown={
        activate && ready
          ? (event) => {
              if (event.button !== 0 || event.ctrlKey || event.metaKey) return;
              event.preventDefault();
              activate(
                index,
                clickPoint(
                  event.currentTarget,
                  index,
                  event.clientX,
                  event.clientY,
                ),
              );
            }
          : undefined
      }
      onKeyDown={
        activate && ready
          ? (event) => {
              if (event.key !== "Enter" || event.target !== event.currentTarget)
                return;
              event.preventDefault();
              activate(index);
            }
          : undefined
      }
    >
      {showMarker && index > 0 && (
        <span className="document-page-marker" aria-hidden="true">
          {index + 1}
        </span>
      )}
      {editing ? (
        editor?.content
      ) : (
        <PreviewSlice
          args={args}
          layout={layout}
          index={index}
          headings={headings}
          ready={setReady}
          resolveResource={resolveResource}
          find={find}
          matches={matches}
          projectedMatches={projectedMatches}
          revealFind={revealFind}
        />
      )}
    </div>
  );
}

const noHeadings: MarkdownHeading[] = [];

export const PagedPreview = forwardRef<
  PagedPreviewHandle,
  {
    args: PreviewArgs;
    findHit?: SearchHit;
    findMatches?: FindMatches;
    onFindPage?: (page: number) => void;
    layout?: DocumentPages;
    onPage: (page: number) => void;
    headings?: MarkdownHeading[];
    showMarkers: boolean;
    style: CSSProperties;
    className?: string;
    editor?: PageEditor;
    preparing: boolean;
    onTogglePreparing: () => void;
    onOpen: (path: string) => void;
    onError: (message: string) => void;
    resolveResource: (source: string) => Promise<string>;
    initialFragment?: string;
    onScroll: (
      ratio: number,
      viewport: HTMLElement,
      programmatic: boolean,
    ) => void;
  }
>(function PagedPreview(
  {
    args,
    findHit,
    findMatches,
    onFindPage,
    layout,
    onPage,
    headings,
    showMarkers,
    style,
    className = "",
    editor,
    preparing,
    onTogglePreparing,
    onOpen,
    onError,
    resolveResource,
    initialFragment,
    onScroll,
  },
  ref,
) {
  const [text, , , , , path, standalone] = args;
  const count = layout?.pages.length ?? 0;
  const fullHeadings = headings ?? noHeadings;
  const layoutHeadings = layout?.headings ?? fullHeadings;
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const anchor = useRef<PageAnchor>({ index: 0, fraction: 0 });
  const ignoreTop = useRef<number | null>(null);
  const queuedFragment = useRef(initialFragment);
  const queuedRatio = useRef<number | null>(null);
  const pendingFragment = useRef<{ index: number; id: string } | undefined>(
    undefined,
  );
  const readingAnchor = useRef<{ index: number; block: number; top: number }>(
    undefined,
  );
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(720);
  const [width, setWidth] = useState(0);
  const [measurements, setMeasurements] = useState(
    () => new Map<number, number>(),
  );
  const zoom = Number(style.zoom) || 1;
  const measure = useCallback((index: number, height: number) => {
    if (!height) return;
    setMeasurements((prev) => {
      if (Math.abs((prev.get(index) ?? 0) - height) < 0.5) return prev;
      return new Map(prev).set(index, height);
    });
  }, []);
  const offsets = useMemo(() => {
    const values = [0];
    const charactersPerLine = Math.max(18, (width || 720) / 10);
    for (let index = 0; index < count; index++) {
      const length =
        (layout?.pages[index + 1]?.start ?? text.length) -
        layout!.pages[index].start;
      const estimate = Math.max(36, (length / charactersPerLine) * 32);
      values.push(values[index] + (measurements.get(index) ?? estimate));
    }
    return values;
  }, [layout, count, text.length, width, measurements]);

  function contentTop() {
    const node = viewport.current;
    return node && content.current
      ? content.current.getBoundingClientRect().top -
          node.getBoundingClientRect().top +
          node.scrollTop
      : 0;
  }
  function pageBounds(index: number) {
    const start = content.current?.querySelector<HTMLElement>(
      '[data-page-index="' + index + '"],[data-editor-page="' + index + '"]',
    );
    if (!start) return undefined;
    const root = start.closest<HTMLElement>(".document-page")!;
    const top = start.getBoundingClientRect().top;
    const end = root.querySelector('[data-editor-page="' + (index + 1) + '"]');
    const bottom = (end ?? root).getBoundingClientRect()[
      end ? "top" : "bottom"
    ];
    return { root, top, bottom, height: bottom - top };
  }
  function anchorAt(top: number): PageAnchor {
    const readingLine =
      (viewport.current?.getBoundingClientRect().top ?? 0) + 1;
    for (const page of content.current?.querySelectorAll<HTMLElement>(
      "[data-page-index],[data-editor-page]",
    ) ?? []) {
      const index = Number(page.dataset.pageIndex ?? page.dataset.editorPage);
      const bounds = pageBounds(index);
      if (bounds && bounds.top <= readingLine && readingLine < bounds.bottom)
        return {
          index,
          fraction: Math.min(0.999, (readingLine - bounds.top) / bounds.height),
        };
    }
    const offset = Math.max(0, (top - contentTop()) / zoom);
    const index = pageAtOffset(offsets, offset);
    return {
      index,
      fraction: Math.min(
        0.999,
        (offset - offsets[index]) / (offsets[index + 1] - offsets[index]),
      ),
    };
  }
  function setTop(top: number) {
    const node = viewport.current;
    if (!node) return;
    const before = node.scrollTop;
    node.scrollTop = top;
    if (Math.abs(node.scrollTop - before) > 0.5)
      ignoreTop.current = node.scrollTop;
    setScrollTop(node.scrollTop);
  }
  function place(target: PageAnchor) {
    const index = Math.min(count - 1, target.index);
    if (index < 0) return;
    anchor.current = { ...target, index };
    if (index === 0 && !target.fraction) {
      setTop(0);
      return;
    }
    const node = viewport.current;
    const bounds = pageBounds(index);
    setTop(
      node && bounds
        ? node.scrollTop +
            bounds.top -
            node.getBoundingClientRect().top +
            target.fraction * bounds.height
        : contentTop() +
            zoom *
              (offsets[index] +
                target.fraction * (offsets[index + 1] - offsets[index])),
    );
  }
  function keepReadingPosition() {
    const node = viewport.current;
    const saved = readingAnchor.current;
    const bounds = saved && pageBounds(saved.index);
    const block = bounds && pageBlocks(bounds.root, saved.index)[saved.block];
    if (!node || !saved || !block) return false;
    setTop(
      node.scrollTop +
        block.getBoundingClientRect().top -
        node.getBoundingClientRect().top -
        saved.top,
    );
    return true;
  }
  function preserve() {
    const node = viewport.current;
    if (node) {
      const current = anchorAt(node.scrollTop);
      const bounds = pageBounds(current.index);
      const top = node.getBoundingClientRect().top;
      const blocks = bounds ? pageBlocks(bounds.root, current.index) : [];
      let block =
        blocks.findIndex(
          (element) => element.getBoundingClientRect().top > top + 1,
        ) - 1;
      if (block === -2) block = blocks.length - 1;
      block = Math.max(0, block);
      if (blocks[block])
        readingAnchor.current = {
          index: current.index,
          block,
          top: blocks[block].getBoundingClientRect().top - top,
        };
    }
  }
  function activate(index: number, point?: PagePoint) {
    preserve();
    editor?.activate(index, point);
  }
  function publish(target: PageAnchor, programmatic: boolean) {
    onPage(target.index);
    if (viewport.current)
      onScroll(
        (target.index + target.fraction) / count,
        viewport.current,
        programmatic,
      );
  }
  function showPage(index: number, programmatic = false) {
    if (index < 0 || index >= count) return;
    pendingFragment.current = undefined;
    readingAnchor.current = undefined;
    const target = { index, fraction: 0 };
    place(target);
    publish(target, programmatic);
  }
  function revealFind(rect: DOMRect) {
    const node = viewport.current;
    if (!node) return;
    const bounds = node.getBoundingClientRect();
    if (rect.top < bounds.top + 8 || rect.bottom > bounds.bottom - 8)
      setTop(node.scrollTop + rect.top - bounds.top - node.clientHeight / 3);
    anchor.current = anchorAt(node.scrollTop);
    preserve();
    publish(anchor.current, true);
  }
  function scrollTo(ratio: number) {
    if (!count) {
      queuedRatio.current = ratio;
      return;
    }
    const progress = ratio * count;
    readingAnchor.current = undefined;
    const index = Math.min(count - 1, Math.floor(progress + 1e-8));
    place({ index, fraction: Math.max(0, progress - index) });
    onPage(index);
  }
  function applyFragment(index: number) {
    const target = pendingFragment.current;
    const node = viewport.current;
    if (
      !target ||
      target.index !== index ||
      !node ||
      !scrollToFragment(node, target.id)
    )
      return false;
    pendingFragment.current = undefined;
    ignoreTop.current = node.scrollTop;
    setScrollTop(node.scrollTop);
    anchor.current = { ...anchorAt(node.scrollTop), index };
    publish(anchor.current, false);
    return true;
  }
  const latestFragment = useRef(applyFragment);
  latestFragment.current = applyFragment;
  const onSliceReady = useCallback((index: number) => {
    // Wait until this slice's actual height has replaced the placeholder.
    requestAnimationFrame(() => latestFragment.current(index));
  }, []);
  function jump(fragment: string) {
    if (!layout) {
      queuedFragment.current = fragment;
      return;
    }
    let decoded = fragment;
    try {
      decoded = decodeURIComponent(fragment);
    } catch {
      /* Literal fragment. */
    }
    const numbered = /mdk-heading-(\d+)$/.exec(decoded);
    const counts = new Map<string, number>();
    const heading = numbered
      ? (fullHeadings[Number(numbered[1]) - 1] ??
        layout.headings?.[Number(numbered[1]) - 1])
      : fullHeadings.find(({ title }) => {
          const slug = title
            .trim()
            .toLowerCase()
            .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, "")
            .replace(/\s+/g, "-");
          const count = counts.get(slug) ?? 0;
          counts.set(slug, count + 1);
          return decoded === (count ? slug + "-" + count : slug);
        });
    if (heading) {
      const index = pageAtLine(layout.pages, heading.line);
      const id = numbered
        ? "mdk-heading-" + numbered[1]
        : "mdk-heading-" + ((heading as MarkdownHeading).index + 1);
      pendingFragment.current = { index, id };
      const target = { index, fraction: 0 };
      if (!applyFragment(index)) {
        place(target);
        publish(target, false);
      }
    } else if (
      viewport.current &&
      scrollToFragment(viewport.current, fragment)
    ) {
      const target = anchorAt(viewport.current.scrollTop);
      anchor.current = target;
      publish(target, false);
    } else if (!fullHeadings.length) {
      queuedFragment.current = fragment;
    }
  }
  useImperativeHandle(ref, () => ({ jump, scrollTo, showPage, preserve, revealFind }));
  useLayoutEffect(() => {
    const node = viewport.current;
    const paper = content.current;
    if (!node || !paper) return;
    let previousWidth = 0;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === node) setHeight(node.clientHeight);
        else if (Math.abs(entry.contentRect.width - previousWidth) > 1) {
          if (previousWidth) setMeasurements(new Map());
          previousWidth = entry.contentRect.width;
          setWidth(previousWidth);
        }
      }
    });
    observer.observe(node);
    observer.observe(paper);
    return () => observer.disconnect();
  }, [!!count]);
  useLayoutEffect(() => {
    if (!count) return;
    if (queuedRatio.current !== null) {
      const progress = queuedRatio.current;
      queuedRatio.current = null;
      scrollTo(progress);
    } else if (!keepReadingPosition()) place(anchor.current);
  }, [offsets, count, zoom, height]);
  useLayoutEffect(() => {
    keepReadingPosition();
  }, [editor?.range?.first, editor?.range?.last]);
  useLayoutEffect(() => {
    if (!layout || !queuedFragment.current) return;
    const fragment = queuedFragment.current;
    queuedFragment.current = undefined;
    jump(fragment);
  }, [layout, fullHeadings]);
  const target = useMemo(() => {
    if (!findHit || !layout) return;
    const location = projectFindHit(findHit, args[0]);
    const index = pageAtOffset([...layout.pages.map(({ start }) => start), Infinity], location.start);
    const page = layout.pages[index];
    const delta = (page.tableHeader?.length ?? 0) - page.start;
    return { index, location: { ...location, start: location.start + delta, end: location.end + delta } };
  }, [findHit, layout, args[0]]);
  const projectedMatches = useMemo(() =>
    findMatches && findMatches.document.content !== args[0]
      ? findLocations(findMatches, args[0]).sort((a, b) => a.start - b.start)
      : undefined, [findMatches, args[0]]);
  useLayoutEffect(() => {
    if (!target) return;
    showPage(target.index, true);
    onFindPage?.(target.index);
  }, [target]);

  const localTop = Math.max(0, (scrollTop - contentTop()) / zoom);
  const overscan = height / zoom;
  const first = Math.max(0, pageAtOffset(offsets, localTop - overscan) - 1);
  const last = Math.min(
    count - 1,
    pageAtOffset(offsets, localTop + overscan * 2) + 1,
  );
  const visible = count
    ? Array.from({ length: last - first + 1 }, (_, offset) => first + offset)
    : [];
  // Keep the focused editor mounted even when the user scrolls away from it.
  const range = editor?.content ? editor.range : undefined;
  if (range && (range.first < first || range.first > last)) {
    if (range.first < first) visible.unshift(range.first);
    else visible.push(range.first);
  }
  let previous = 0;
  return (
    <div className={"paged-preview " + className}>
      <div
        className="paged-preview-viewport"
        tabIndex={0}
        ref={viewport}
        onInputCapture={() => {
          readingAnchor.current = undefined;
        }}
        onScroll={(event) => {
          if (!count) return;
          const node = event.currentTarget;
          setScrollTop(node.scrollTop);
          const programmatic =
            ignoreTop.current !== null &&
            Math.abs(ignoreTop.current - node.scrollTop) < 1;
          ignoreTop.current = null;
          if (!programmatic) {
            pendingFragment.current = undefined;
            readingAnchor.current = undefined;
            anchor.current = anchorAt(node.scrollTop);
          }
          publish(anchor.current, programmatic);
        }}
      >
        {!layout ? (
          <div className="editor-loading">
            <p role="status">
              {preparing ? t("正在分页排版…") : t("已取消排版。")}
            </p>
            <button className="button small" onClick={onTogglePreparing}>
              {preparing ? t("取消排版") : t("重新排版")}
            </button>
          </div>
        ) : (
          <article
            className="document-paper preview-body continuous-paper"
            style={style}
            data-source-path={path}
            data-page-markers={showMarkers}
            onClick={(event) => {
              if (
                (event.target as Element).closest("[data-document-drop-zone]")
              )
                return;
              const link = (event.target as Element).closest("a");
              const href = link?.dataset.mdkLink ?? link?.getAttribute("href");
              if (href?.startsWith("#") && href.length > 1) {
                event.preventDefault();
                jump(href.slice(1));
              } else {
                followPreviewLink(
                  event,
                  path ?? "",
                  !!standalone,
                  onOpen,
                  onError,
                );
              }
            }}
          >
            <div className="continuous-content" ref={content}>
              {visible.map((index) => {
                if (range && index > range.first && index <= range.last)
                  return null;
                const editing = range?.first === index;
                const gap = offsets[index] - offsets[previous];
                previous = (editing ? range.last : index) + 1;
                return (
                  <Fragment key={editing ? "editor-window" : index}>
                    {gap > 0 && (
                      <div style={{ height: gap }} aria-hidden="true" />
                    )}
                    <PageSlice
                      args={args}
                      layout={layout}
                      index={index}
                      height={offsets[index + 1] - offsets[index]}
                      headings={layoutHeadings}
                      showMarker={showMarkers}
                      editor={editor && { ...editor, activate }}
                      zoom={zoom}
                      onMeasure={measure}
                      onReady={onSliceReady}
                      resolveResource={resolveResource}
                      find={target?.index === index ? target.location : undefined}
                      matches={findMatches}
                      projectedMatches={projectedMatches}
                      revealFind={revealFind}
                    />
                  </Fragment>
                );
              })}
              <div
                style={{ height: offsets[count] - offsets[previous] }}
                aria-hidden="true"
              />
            </div>
          </article>
        )}
      </div>
    </div>
  );
});
