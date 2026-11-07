import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { markdownTask } from "../services/markdown-tasks";
import {
  followPreviewLink,
  scrollToFragment,
} from "../services/document-links";
import type { renderPreviewPages } from "../services/preview";

export interface PagedPreviewHandle {
  scrollTo: (ratio: number) => void;
  jump: (fragment: string) => void;
}

export const PagedPreview = forwardRef<
  PagedPreviewHandle,
  {
    args: Parameters<typeof renderPreviewPages>;
    style: CSSProperties;
    className?: string;
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
    style,
    className = "",
    onOpen,
    onError,
    onScroll,
    resolveResource,
    initialFragment,
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
  const [pages, setPages] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  const [cancelled, setCancelled] = useState(false);
  const [error, setError] = useState("");
  const viewport = useRef<HTMLDivElement>(null);
  const article = useRef<HTMLElement>(null);
  const pending = useRef<number | string | null>(null);
  const ignore = useRef<number | null>(null);
  const queuedFragment = useRef(initialFragment);
  const queuedRatio = useRef<number | null>(null);
  useEffect(() => {
    if (cancelled) return;
    setError("");
    let stop: (() => void) | undefined;
    const delay = setTimeout(() => {
      stop = markdownTask<string[]>(
        {
          kind: "preview",
          args: [
            text,
            settings,
            position,
            mode,
            namespace,
            path,
            standalone,
            reserved,
          ],
        },
        (next) => {
          setPages(next);
          setPage((previous) => Math.min(previous, next.length - 1));
        },
        setError,
      );
    }, 150);
    return () => {
      clearTimeout(delay);
      stop?.();
    };
  }, [
    text,
    settings,
    position,
    mode,
    namespace,
    path,
    standalone,
    reserved,
    cancelled,
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
  }, [pages, page, resolveResource]);

  function place() {
    const node = viewport.current;
    if (!node || pending.current === null) return;
    const target = pending.current;
    pending.current = null;
    if (typeof target === "string") {
      scrollToFragment(node, target);
    } else {
      node.scrollTop =
        target * Math.max(0, node.scrollHeight - node.clientHeight);
      ignore.current = node.scrollTop;
    }
    if (pages.length) {
      const range = node.scrollHeight - node.clientHeight;
      onScroll(
        (page + (range > 0 ? node.scrollTop / range : 0)) / pages.length,
        node,
        true,
      );
    }
  }
  function go(index: number, target: number | string, report = false) {
    pending.current = target;
    if (index === page) place();
    else setPage(index);
    if (report && viewport.current)
      onScroll(index / pages.length, viewport.current, false);
  }
  function jump(fragment: string) {
    if (!pages.length) {
      queuedFragment.current = fragment;
      return;
    }
    let decoded = fragment;
    try {
      decoded = decodeURIComponent(fragment);
    } catch {
      /* Literal fragment. */
    }
    const index = pages.findIndex(
      (html) =>
        html.includes(`id="${decoded}"`) ||
        html.includes(`id="${namespace}${decoded}"`) ||
        html.includes(`data-fragment="${decoded}"`),
    );
    if (index >= 0) go(index, decoded);
  }
  function scrollTo(ratio: number) {
    if (!pages.length) {
      queuedRatio.current = ratio;
      return;
    }
    const index = Math.min(pages.length - 1, Math.floor(ratio * pages.length));
    go(index, ratio * pages.length - index);
  }
  useImperativeHandle(ref, () => ({ jump, scrollTo }));
  useLayoutEffect(place, [page, pages]);
  useLayoutEffect(() => {
    if (pages.length && queuedFragment.current) {
      const fragment = queuedFragment.current;
      queuedFragment.current = undefined;
      jump(fragment);
    } else if (pages.length && queuedRatio.current !== null) {
      const ratio = queuedRatio.current;
      queuedRatio.current = null;
      scrollTo(ratio);
    }
  }, [pages]);
  return (
    <div className={"paged-preview " + className}>
      <div className="paged-preview-bar">
        <button
          className="button small"
          disabled={page <= 0}
          onClick={() => go(page - 1, 0, true)}
        >
          上一页
        </button>
        <span>
          {pages.length ? `${page + 1} / ${pages.length}` : "分页预览"}
        </span>
        <button
          className="button small"
          disabled={page + 1 >= pages.length}
          onClick={() => go(page + 1, 0, true)}
        >
          下一页
        </button>
        {!error && (!pages.length || cancelled) && (
          <button
            className="button small"
            onClick={() => setCancelled(!cancelled)}
          >
            {cancelled ? "重新排版" : "取消排版"}
          </button>
        )}
      </div>
      <div
        className="paged-preview-viewport"
        ref={viewport}
        onScroll={(event) => {
          const node = event.currentTarget;
          if (!pages.length) return;
          const programmatic = ignore.current === node.scrollTop;
          ignore.current = null;
          const range = node.scrollHeight - node.clientHeight;
          onScroll(
            (page + (range > 0 ? node.scrollTop / range : 0)) / pages.length,
            node,
            programmatic,
          );
        }}
      >
        {error ? (
          <p role="alert">{error}</p>
        ) : !pages.length ? (
          <p className="editor-loading" role="status">
            {cancelled ? "已取消排版。" : "正在分页排版…"}
          </p>
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
            dangerouslySetInnerHTML={{ __html: pages[page] ?? "" }}
          />
        )}
      </div>
    </div>
  );
});
