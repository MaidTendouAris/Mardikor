import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { t } from "../../shared/i18n";
import { defaultSettings } from "../../shared/defaults";
import { entryDisplayName, type ReadingUnit } from "../../shared/mdk";
import { reservedSectionNumbers } from "../../shared/heading-numbering";
import { resolveReference } from "../../shared/references";
import { desktop } from "../services/desktop";
import { findPreviewFragment } from "../services/document-links";
import type { FindMatches, SearchHit } from "../services/document-find";
import { findLocations, projectFindHit } from "../services/find-mapping";
import { useMappedFind, useMappedMatches } from "../services/use-mapped-find";
import { markdownTask } from "../services/markdown-tasks";
import { PageNavigation } from "./PageNavigation";
import { ReaderSettings, type ReaderSettingsProps } from "./ReaderSettings";
import { Select } from "./Select";
import type { PreviewArgs } from "../services/preview-page";
import "../styles/reader.css";

const fonts = {
  system: 'system-ui, "Microsoft YaHei", sans-serif',
  serif: '"Noto Serif CJK SC", "Songti SC", SimSun, Georgia, serif',
  mono: 'Consolas, "Cascadia Mono", monospace',
};
const headingSelector = "h1[id],h2[id],h3[id],h4[id],h5[id],h6[id]";

function readerPreviewArgs(
  unit: ReadingUnit,
  namespace: string,
  numbered: boolean,
  reserved?: ReadonlySet<string>,
): PreviewArgs {
  const settings = defaultSettings();
  settings.preview.show_toc = false;
  settings.mode.book.chapter_numbering = numbered;
  return [
    unit.markdown ?? "",
    settings,
    unit.position,
    "01",
    namespace,
    unit.path,
    false,
    reserved,
    undefined,
    true,
    true,
  ];
}

function ReaderManuscript({
  unit,
  file,
  namespace,
  numbered,
  reserved,
  ready,
  findHit,
  findMatches,
  revealFind,
}: {
  unit: ReadingUnit;
  file: string;
  namespace: string;
  numbered: boolean;
  reserved?: ReadonlySet<string>;
  ready: () => void;
  findHit?: SearchHit;
  findMatches?: FindMatches;
  revealFind: (rect: DOMRect) => void;
}) {
  const [output, setOutput] = useState<{ html?: string; error?: string }>();
  const article = useRef<HTMLElement>(null);
  const onReady = useRef(ready);
  onReady.current = ready;
  useEffect(() => {
    if (unit.markdown === null) return;
    return markdownTask<string>(
      {
        kind: "preview",
        args: readerPreviewArgs(unit, namespace, numbered, reserved),
      },
      (html) => setOutput({ html }),
      (error) => setOutput({ error }),
    );
  }, [namespace, numbered, reserved, unit]);
  useLayoutEffect(() => {
    if (output || unit.markdown === null) onReady.current();
  }, [output, unit.markdown]);
  useEffect(() => {
    if (output?.html === undefined || !article.current) return;
    let live = true;
    const resources = new Map<string, Promise<string>>();
    for (const image of article.current.querySelectorAll<HTMLImageElement>(
      "img[data-mdk-ref]",
    )) {
      const source = image.dataset.mdkRef ?? "";
      const target = resolveReference(unit.path, source, true);
      if (target.kind !== "local") {
        image.alt ||= t("资源不可用：") + source;
        continue;
      }
      let pending = resources.get(target.path);
      if (!pending) {
        pending = desktop().invoke("readResource", file, target.path);
        resources.set(target.path, pending);
      }
      void pending.then(
        (data) => {
          if (live) image.src = data;
        },
        () => {
          if (live) image.alt ||= t("资源不可用：") + source;
        },
      );
    }
    return () => {
      live = false;
    };
  }, [file, output, unit.path]);
  const location = useMemo(() => findHit && unit.markdown !== null
    ? projectFindHit(findHit, unit.markdown) : undefined, [findHit, unit.markdown]);
  useMappedFind(article, unit.markdown ?? "", location, output?.html, revealFind);
  const locations = useMemo(() => unit.markdown !== null
    ? findLocations(findMatches, unit.markdown) : [], [findMatches, unit.markdown]);
  useMappedMatches(article, unit.markdown ?? "", locations, output?.html);
  return (
    <article
      className="preview-body reader-manuscript"
      data-source-path={unit.path}
      data-ready={output || unit.markdown === null ? "" : undefined}
      ref={article}
    >
      {unit.markdown === null ? (
        <p role="alert">
          {t("文稿缺失或无法按 UTF-8 读取：")}
          {unit.path}
        </p>
      ) : output?.error ? (
        <p role="alert">{output.error}</p>
      ) : output?.html !== undefined ? (
        <div
          className="reader-markdown"
          dangerouslySetInnerHTML={{ __html: output.html }}
        />
      ) : (
        <p role="status">{t("正在排版文稿…")}</p>
      )}
    </article>
  );
}

interface ReaderProps extends ReaderSettingsProps {
  file: string;
  revision: string;
  activePath: string;
  heading?: { path: string; index: number; key: number };
  findHit?: SearchHit;
  findDocuments: ReadonlyMap<string, FindMatches>;
  onHeading: (path: string, index: number) => void;
  onScroll: (ratio: number) => void;
  openFile: (path: string) => void;
}

export interface DocumentReaderHandle {
  scrollTo: (ratio: number) => void;
  currentDocument: () => Pick<ReadingUnit, "path" | "id"> | undefined;
}

export const DocumentReader = forwardRef<DocumentReaderHandle, ReaderProps>(
  function DocumentReader(
    {
      file,
      revision,
      activePath,
      heading,
      findHit,
      findDocuments,
      onHeading,
      onScroll,
      openFile,
      ...settings
    },
    ref,
  ) {
    const {
      comic,
      value: { style },
      notify,
    } = settings;
    const [loaded, setLoaded] = useState<{
      units: ReadingUnit[];
      revision: string;
      error?: string;
    }>();
    const [unitId, setUnitId] = useState("");
    const [additionalUnit, setAdditionalUnit] = useState<ReadingUnit>();
    const [page, setPage] = useState({
      index: 0,
      count: 1,
      unit: "",
      columns: 1,
    });
    const viewport = useRef<HTMLDivElement>(null);
    const spread = useRef<HTMLDivElement>(null);
    const requestedPath = useRef("");
    const progress = useRef(0);
    const expectedScroll = useRef<number | undefined>(undefined);
    const fragment = useRef<{ path: string; id: string } | undefined>(
      undefined,
    );
    const namespace = useId().replace(/[^a-z0-9-]/gi, "") + "-reader-";
    const units = useMemo(() => {
      if (!loaded) return;
      if (!additionalUnit || loaded.units.some(({ path }) => path === additionalUnit.path))
        return loaded.units;
      return [...loaded.units, additionalUnit];
    }, [loaded, additionalUnit]);
    const pagedBook = !comic && style.layout === "paged";
    const pagedComic = comic && style.layout === "paged";
    const spreadSize = pagedComic && style.comicSpread === "double" ? 2 : 1;
    const index = Math.max(
      0,
      units?.findIndex(({ id }) => id === unitId) ?? -1,
    );
    const first = index - (index % spreadSize);
    const visible = units?.slice(first, first + spreadSize) ?? [];
    const currentUnit = visible[0]?.id ?? "";
    const pageReady = currentUnit !== "" && page.unit === currentUnit;
    const reserved = useMemo(
      () =>
        reservedSectionNumbers(units?.map(({ position }) => position) ?? []),
      [units],
    );
    useEffect(() => {
      let live = true;
      void desktop()
        .invoke("readingUnits", file)
        .then(
          (units) => {
            if (live) setLoaded({ units, revision });
          },
          (error) => {
            if (live) setLoaded({ units: [], revision, error: String(error) });
          },
        );
      return () => {
        live = false;
      };
    }, [file, revision]);
    useLayoutEffect(() => {
      if (!units) return;
      const changedPath = activePath !== requestedPath.current;
      if (!changedPath && units.some(({ id }) => id === unitId)) return;
      if (requestedPath.current) progress.current = 0;
      requestedPath.current = activePath;
      const selected = units?.find(({ path }) => path === activePath);
      if (selected) {
        setUnitId(selected.id);
      }
    }, [activePath, units]);

    function bookLayout(node: HTMLElement) {
      const flow = spread.current!;
      const css = getComputedStyle(flow);
      const columns = Number(css.columnCount) || 1;
      const gap = parseFloat(css.columnGap) || 0;
      const width = flow.getBoundingClientRect().width;
      const step = width + gap;
      const count = Math.max(
        1,
        1 + Math.ceil((flow.scrollWidth - width - 1) / step),
      );
      const extent = Math.ceil(width + (count - 1) * step) + "px";
      if (node.style.getPropertyValue("--reader-track-width") !== extent)
        node.style.setProperty("--reader-track-width", extent);
      return { count, columns, step, firstPageWidth: step / columns - gap };
    }
    function follow(node: HTMLElement, firstPageWidth?: number) {
      const bounds = node.getBoundingClientRect();
      let current: HTMLElement | undefined;
      for (const row of node.querySelectorAll<HTMLElement>(headingSelector)) {
        const rect = row.getBoundingClientRect();
        if (firstPageWidth !== undefined) {
          if (rect.left >= bounds.left + firstPageWidth) break;
          if (
            !current ||
            rect.left < bounds.left ||
            rect.top <= bounds.top + 24
          )
            current = row;
        } else {
          if (current && rect.top > bounds.top + 24) break;
          current = row;
        }
      }
      const path =
        current?.closest<HTMLElement>("[data-source-path]")?.dataset
          .sourcePath ?? visible[0]?.path;
      if (path) {
        const number = /mdk-heading-(\d+)$/.exec(current?.id ?? "");
        onHeading(path, number ? Number(number[1]) - 1 : -1);
      }
    }
    function observePosition() {
      const node = viewport.current;
      if (
        !node ||
        !node.clientWidth ||
        !spread.current ||
        node.querySelector(".reader-manuscript:not([data-ready])")
      )
        return false;
      let firstPageWidth: number | undefined;
      if (pagedBook) {
        const layout = bookLayout(node);
        const { count, columns, step } = layout;
        firstPageWidth = layout.firstPageWidth;
        const index = Math.min(count - 1, Math.round(node.scrollLeft / step));
        progress.current = count > 1 ? index / (count - 1) : 0;
        setPage((current) =>
          current.index === index &&
          current.count === count &&
          current.unit === currentUnit &&
          current.columns === columns
            ? current
            : { index, count, unit: currentUnit, columns },
        );
      } else {
        const distance = node.scrollHeight - node.clientHeight;
        progress.current = distance > 0 ? node.scrollTop / distance : 0;
      }
      follow(node, firstPageWidth);
      return true;
    }
    function locate(node: HTMLElement, rect: DOMRect, step?: number) {
      const bounds = node.getBoundingClientRect();
      if (step !== undefined) {
        node.scrollLeft =
          Math.floor((rect.left - bounds.left + node.scrollLeft + 1) / step) *
          step;
      } else {
        node.scrollTop += rect.top - bounds.top;
      }
    }
    function restore() {
      const node = viewport.current;
      if (!node || !node.clientWidth) return;
      const height = node.clientHeight + "px";
      if (node.style.getPropertyValue("--reader-page-height") !== height)
        node.style.setProperty("--reader-page-height", height);
      const layout = pagedBook && spread.current ? bookLayout(node) : undefined;
      const pending = fragment.current;
      const article =
        pending &&
        Array.from(
          node.querySelectorAll<HTMLElement>("[data-source-path]"),
        ).find(({ dataset }) => dataset.sourcePath === pending.path);
      const target =
        pending && article && findPreviewFragment(article, pending.id);
      if (article?.hasAttribute("data-ready")) fragment.current = undefined;
      if (target) {
        locate(node, target.getBoundingClientRect(), layout?.step);
      } else if (layout) {
        node.scrollLeft =
          Math.round(progress.current * (layout.count - 1)) * layout.step;
      } else {
        node.scrollTop =
          progress.current * (node.scrollHeight - node.clientHeight);
      }
      if (observePosition()) expectedScroll.current = progress.current;
    }
    useImperativeHandle(ref, () => ({
      currentDocument: () => units?.[index],
      scrollTo(ratio) {
        progress.current = ratio;
        restore();
      },
    }));
    const latestRestore = useRef(restore);
    latestRestore.current = restore;
    useLayoutEffect(() => {
      const node = viewport.current;
      if (!node) return;
      const resize = new ResizeObserver(() => latestRestore.current());
      resize.observe(node);
      return () => resize.disconnect();
    }, []);
    useLayoutEffect(restore, [first, units, style]);

    function openUnit(next: number, id?: string, end = false) {
      const unit = units?.[next];
      if (!unit) return;
      fragment.current = id ? { path: unit.path, id } : undefined;
      progress.current = end ? 1 : 0;
      setUnitId(unit.id);
      if (next >= first && next < first + spreadSize) restore();
    }
    useLayoutEffect(() => {
      if (!findHit || !units) return;
      const target = units[index]?.path === findHit.path ? index
        : units.findIndex(({ path }) => path === findHit.path);
      if (target < 0) {
        const id = "find:" + findHit.path;
        setAdditionalUnit({ path: findHit.path, markdown: findHit.content, id, position: "" });
        fragment.current = undefined;
        progress.current = 0;
        setUnitId(id);
      } else if (target !== index) openUnit(target);
    }, [findHit, units]);
    function revealFind(rect: DOMRect) {
      const node = viewport.current;
      if (!node) return;
      locate(node, rect, pagedBook ? bookLayout(node).step : undefined);
      if (observePosition()) expectedScroll.current = progress.current;
    }
    useEffect(() => {
      if (!heading) return;
      const next = units?.findIndex(({ path }) => path === heading.path) ?? -1;
      if (next >= 0)
        openUnit(
          next,
          heading.index < 0 ? undefined : "mdk-heading-" + (heading.index + 1),
        );
    }, [heading, units]);

    function turn(direction: number) {
      if (pagedBook && !pageReady) return;
      const node = viewport.current;
      if (
        node &&
        pagedBook &&
        page.index + direction >= 0 &&
        page.index + direction < page.count
      ) {
        node.scrollLeft = (page.index + direction) * bookLayout(node).step;
        observePosition();
      } else {
        openUnit(
          first + direction * spreadSize,
          undefined,
          pagedBook && direction < 0,
        );
      }
    }
    function followLink(event: MouseEvent<HTMLDivElement>) {
      const link = (event.target as Element).closest<HTMLAnchorElement>("a");
      const source =
        link?.closest<HTMLElement>("[data-source-path]")?.dataset.sourcePath;
      if (!link || !source) return;
      event.preventDefault();
      const href = link.dataset.mdkLink ?? link.getAttribute("href") ?? "";
      if (!href || href === "#") return;
      if (href.startsWith("#")) {
        const next = units?.findIndex(({ path }) => path === source) ?? -1;
        if (next >= 0) openUnit(next, href.slice(1));
        return;
      }
      const target = resolveReference(source, href);
      if (target.kind === "external")
        void desktop()
          .openExternal(target.url)
          .catch((error) => notify(String(error), true));
      else if (target.kind === "local") {
        const next = units?.findIndex(({ path }) => path === target.path) ?? -1;
        if (next >= 0)
          openUnit(
            next,
            target.suffix.startsWith("#") ? target.suffix.slice(1) : undefined,
          );
        else openFile(target.path);
      }
    }
    const total = units?.length ?? 0;
    const rtl = pagedComic && style.comicDirection === "rtl";
    return (
      <section
        className={`document-reader ${pagedBook ? "reader-paged-book reader-book-" + style.bookSpread : ""} ${pagedComic ? "reader-paged-comic" : ""} ${rtl ? "reader-rtl" : ""} ${style.comicFit === "width" ? "reader-fit-width" : ""} ${style.widthMode === "limited" ? "reader-width-limited" : ""}`}
        aria-label={t("阅读模式")}
        style={
          {
            "--reader-font": fonts[style.font],
            "--reader-font-size": style.fontSize + "px",
            "--reader-line-height": style.lineHeight,
            "--reader-indent": style.firstLineIndent + "em",
            "--reader-paragraph-spacing": style.paragraphSpacing + "em",
            "--reader-text-width": style.textWidth + "px",
            "--reader-page-gap": style.pageGap + "px",
            "--reader-page-margin-inline": style.pageMarginInline + "px",
            "--reader-page-margin-block": style.pageMarginBlock + "px",
            "--reader-align": style.justify ? "justify" : "start",
          } as CSSProperties
        }
      >
        <div
          className="reader-viewport"
          ref={viewport}
          tabIndex={0}
          aria-label={t("阅读正文")}
          onScroll={() => {
            if (!observePosition()) return;
            const expected = expectedScroll.current;
            expectedScroll.current = undefined;
            if (
              expected === undefined ||
              Math.abs(expected - progress.current) > 0.004
            )
              onScroll(progress.current);
          }}
          onLoadCapture={restore}
          onClick={followLink}
          onKeyDown={(event) => {
            if (
              event.altKey ||
              event.ctrlKey ||
              event.metaKey ||
              event.shiftKey ||
              (event.target as Element).closest(
                "a,button,input,textarea,select",
              )
            )
              return;
            const key = event.key;
            if (
              key === "ArrowLeft" ||
              key === "ArrowRight" ||
              ((pagedBook || pagedComic) &&
                (key === "PageUp" || key === "PageDown"))
            ) {
              event.preventDefault();
              const previous =
                key === "PageUp" || key === (rtl ? "ArrowRight" : "ArrowLeft");
              turn(previous ? -1 : 1);
            }
          }}
        >
          {!loaded ? (
            <p role="status">{t("正在加载阅读目录…")}</p>
          ) : loaded.error ? (
            <p role="alert">{loaded.error}</p>
          ) : !total ? (
            <p>{t("工程没有可阅读的文稿。")}</p>
          ) : (
            <div
              className={`reader-spread ${visible.length > 1 ? "reader-double" : ""}`}
              ref={spread}
            >
              {visible.map((unit) => (
                <ReaderManuscript
                  key={loaded.revision + ":" + unit.id}
                  unit={unit}
                  file={file}
                  namespace={namespace + units!.indexOf(unit) + "-"}
                  numbered={!comic && style.numberHeadings}
                  reserved={reserved.get(unit.position)}
                  ready={restore}
                  findHit={unit.id === units?.[index]?.id && findHit?.path === unit.path ? findHit : undefined}
                  findMatches={findDocuments.get(unit.path)}
                  revealFind={revealFind}
                />
              ))}
            </div>
          )}
        </div>
        <footer className="reader-controls">
          <div className="reader-chapter">
            <button
              className="icon-button"
              type="button"
              title={t("上一文稿")}
              aria-label={t("上一文稿")}
              disabled={first === 0}
              onClick={() => openUnit(first - spreadSize)}
            >
              <ChevronLeft size={16} />
            </button>
            <Select
              aria-label={t("阅读文稿")}
              value={units?.[index]?.id ?? ""}
              disabled={!total}
              onValueChange={(id) =>
                openUnit(units!.findIndex((unit) => unit.id === id))
              }
            >
              {units?.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.position} ·{" "}
                  {entryDisplayName(unit) ?? unit.path.split("/").at(-1)}
                </option>
              ))}
            </Select>
            <button
              className="icon-button"
              type="button"
              title={t("下一文稿")}
              aria-label={t("下一文稿")}
              disabled={first + spreadSize >= total}
              onClick={() => openUnit(first + spreadSize)}
            >
              <ChevronRight size={16} />
            </button>
          </div>
          {pagedBook && (
            <PageNavigation
              page={page.index}
              count={page.count}
              numberLabel={page.columns === 2 ? t("跨页序号") : undefined}
              disabled={!pageReady}
              previousSection={first > 0 ? () => turn(-1) : undefined}
              nextSection={first + 1 < total ? () => turn(1) : undefined}
              onPage={(index) => {
                const node = viewport.current;
                if (node) node.scrollLeft = index * bookLayout(node).step;
                observePosition();
              }}
            />
          )}
          {pagedComic && (
            <PageNavigation
              page={first / spreadSize}
              count={Math.ceil(total / spreadSize)}
              disabled={!total}
              onPage={(index) => openUnit(index * spreadSize)}
            />
          )}
        </footer>
        <ReaderSettings {...settings} />
      </section>
    );
  },
);
