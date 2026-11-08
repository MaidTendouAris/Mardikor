import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { MarkdownHeading } from "../../shared/markdown";
import { pageAtLine, type DocumentPages } from "../services/document-pages";
import {
  followPreviewLink,
  scrollToFragment,
} from "../services/document-links";
import { markdownTask } from "../services/markdown-tasks";
import type { renderPreview } from "../services/preview";

export interface PagedPreviewHandle {
  scrollTo: (ratio: number) => void;
  jump: (fragment: string) => void;
  showPage: (page: number) => void;
}

export const PagedPreview = forwardRef<
  PagedPreviewHandle,
  {
    args: Parameters<typeof renderPreview>;
    layout?: DocumentPages;
    page: number;
    onPage: (page: number) => void;
    headings: MarkdownHeading[];
    headingOffset: number;
    priorHeadingLevels?: number[];
    style: CSSProperties;
    className?: string;
    editor?: ReactNode;
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
    layout,
    page,
    onPage,
    headings,
    headingOffset,
    priorHeadingLevels,
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
  const [
    text,
    settings,
    position,
    mode,
    namespace,
    path,
    standalone,
    reserved,
  ] = args;
  const count = layout?.pages.length ?? 0;
  const current = layout?.pages[page];
  const [output, setOutput] = useState<{
    page: number;
    html?: string;
    error?: string;
  }>();
  const viewport = useRef<HTMLDivElement>(null);
  const article = useRef<HTMLElement>(null);
  const pending = useRef<number | string | null>(null);
  const ignored = useRef<number | null>(null);
  const queuedFragment = useRef(initialFragment);
  const queuedRatio = useRef<number | null>(null);
  const pageText = current
    ? text.slice(current.start, layout?.pages[page + 1]?.start)
    : "";
  const html = output?.page === page ? output.html : undefined;

  useEffect(() => {
    if (!current || editor) return;
    let stop: (() => void) | undefined;
    const timer = setTimeout(() => {
      stop = markdownTask<string>(
        {
          kind: "preview",
          args: [
            (current.tableHeader ?? "") + pageText,
            settings,
            position,
            mode,
            namespace,
            path,
            standalone,
            reserved,
            {
              headingOffset,
              priorHeadingLevels: priorHeadingLevels ?? [],
              continuedPage: page > 0,
              literal: current.literal,
              references: layout?.references,
              notes: layout?.notes,
            },
          ],
        },
        (html) => setOutput({ page, html }),
        (error) => setOutput({ page, error }),
      );
    }, 100);
    return () => {
      clearTimeout(timer);
      stop?.();
    };
  }, [
    pageText,
    settings,
    position,
    mode,
    namespace,
    path,
    standalone,
    reserved,
    page,
    current,
    !!editor,
    headingOffset,
    priorHeadingLevels,
    layout?.references,
    layout?.notes,
  ]);
  useEffect(() => {
    let live = true;
    article.current
      ?.querySelectorAll<HTMLImageElement>("img[data-mdk-ref]")
      .forEach((image) => {
        void resolveResource(image.dataset.mdkRef ?? "").then(
          (src) => {
            if (live && src) image.src = src;
          },
          () => {
            if (live) image.alt += "（资源不可用）";
          },
        );
      });
    return () => {
      live = false;
    };
  }, [html, page, resolveResource]);

  function ratio(node: HTMLElement) {
    const range = node.scrollHeight - node.clientHeight;
    return (
      (page + (range > 0 ? Math.min(0.999, node.scrollTop / range) : 0)) / count
    );
  }
  function place() {
    const node = viewport.current;
    if (!node || pending.current === null || (!editor && html === undefined))
      return;
    const target = pending.current;
    pending.current = null;
    if (typeof target === "string") scrollToFragment(node, target);
    else
      node.scrollTop =
        target * Math.max(0, node.scrollHeight - node.clientHeight);
    ignored.current = node.scrollTop;
    if (count) onScroll(ratio(node), node, true);
  }
  function go(index: number, target: number | string, report = false) {
    if (!count) return;
    pending.current = target;
    if (index === page) place();
    else onPage(index);
    if (report && viewport.current)
      onScroll(index / count, viewport.current, false);
  }
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
      ? headings[Number(numbered[1]) - 1]
      : headings.find(({ title }) => {
          const slug = title
            .trim()
            .toLowerCase()
            .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, "")
            .replace(/\s+/g, "-");
          const count = counts.get(slug) ?? 0;
          counts.set(slug, count + 1);
          return decoded === (count ? slug + "-" + count : slug);
        });
    if (heading)
      go(
        pageAtLine(layout.pages, heading.line),
        "mdk-heading-" + (heading.index + 1),
        true,
      );
    else if (
      !(viewport.current && scrollToFragment(viewport.current, fragment)) &&
      (!headings.length || html === undefined)
    )
      queuedFragment.current = fragment;
  }
  function scrollTo(progress: number) {
    if (!count) {
      queuedRatio.current = progress;
      return;
    }
    const position = progress * count;
    const index = Math.min(count - 1, Math.floor(position + 1e-8));
    go(index, Math.max(0, position - index));
  }
  useImperativeHandle(ref, () => ({
    jump,
    scrollTo,
    showPage: (index) => go(index, 0, true),
  }));
  useLayoutEffect(place, [page, html, !!editor]);
  useLayoutEffect(() => {
    if (layout && queuedRatio.current !== null) {
      const progress = queuedRatio.current;
      queuedRatio.current = null;
      scrollTo(progress);
    }
  }, [layout]);
  useLayoutEffect(() => {
    if (
      !layout ||
      !queuedFragment.current ||
      (!headings.length && html === undefined)
    )
      return;
    const fragment = queuedFragment.current;
    queuedFragment.current = undefined;
    jump(fragment);
  }, [layout, headings, html]);

  return (
    <div className={"paged-preview " + className}>
      <div
        className="paged-preview-viewport"
        ref={viewport}
        onScroll={(event) => {
          const node = event.currentTarget;
          if (!count) return;
          const programmatic = ignored.current === node.scrollTop;
          ignored.current = null;
          onScroll(ratio(node), node, programmatic);
        }}
      >
        {editor ||
          (output?.page === page && output.error ? (
            <p role="alert">{output.error}</p>
          ) : html === undefined ? (
            <div className="editor-loading">
              <p role="status">
                {preparing ? "正在分页排版…" : "已取消排版。"}
              </p>
              {!count && (
                <button className="button small" onClick={onTogglePreparing}>
                  {preparing ? "取消排版" : "重新排版"}
                </button>
              )}
            </div>
          ) : (
            <article
              ref={article}
              className="document-paper preview-body"
              style={style}
              data-source-path={path}
              onClick={(event) => {
                const anchor = (event.target as Element).closest("a");
                const href =
                  anchor?.dataset.mdkLink || anchor?.getAttribute("href");
                if (href?.startsWith("#") && href.length > 1) {
                  event.preventDefault();
                  jump(href.slice(1));
                } else
                  followPreviewLink(
                    event,
                    path ?? "",
                    !!standalone,
                    onOpen,
                    onError,
                  );
              }}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          ))}
      </div>
    </div>
  );
});
