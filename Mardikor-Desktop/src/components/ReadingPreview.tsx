import { t } from "../../shared/i18n";
import {
  useEffect,
  useRef,
  useState,
  useId,
  useMemo,
  type CSSProperties,
} from "react";
import {
  entryDisplayName,
  type MdkProject,
  type MdkSettings,
  type ReadingUnit,
} from "../../shared/mdk";
import { desktop } from "../services/desktop";
import { mayContainMath, renderPreview } from "../services/preview";
import { usePreviewMath } from "../services/preview-math";
import type { FindMatches, SearchHit } from "../services/document-find";
import { findLocations, projectFindHit } from "../services/find-mapping";
import {
  revealFindRect,
  useMappedFind,
  useMappedMatches,
} from "../services/use-mapped-find";
import { markdownHeadings, type MarkdownHeading } from "../../shared/markdown";
import { v2StyleValue } from "../../shared/v2-typography";

function ReadingPreviewBody({
  markdown,
  html,
  matches,
  hit,
  reveal,
}: {
  markdown: string;
  html: string;
  matches?: FindMatches;
  hit?: SearchHit;
  reveal: (rect: DOMRect) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const location = useMemo(
    () => hit && projectFindHit(hit, markdown),
    [hit, markdown],
  );
  const locations = useMemo(
    () => findLocations(matches, markdown),
    [matches, markdown],
  );
  useMappedFind(root, markdown, location, html, reveal);
  useMappedMatches(root, markdown, locations, html);
  const markup = useMemo(() => ({ __html: html }), [html]);
  return <div ref={root} dangerouslySetInnerHTML={markup} />;
}
import { resolveReference } from "../../shared/references";
import { reservedSectionNumbers } from "../../shared/heading-numbering";
import {
  followPreviewLink,
  scrollToFragment,
} from "../services/document-links";

export function ReadingPreview({
  file,
  project,
  settings,
  style,
  onOpen,
  activeDocument,
  activeEntryId,
  heading,
  onLayout,
  onError,
  initialFragment,
  findHit,
  findEntryId,
  findDocuments,
}: {
  file: string;
  project: MdkProject;
  settings: MdkSettings;
  style: CSSProperties;
  onOpen: (path: string) => void;
  activeDocument?: { path: string; markdown: string };
  activeEntryId?: string;
  heading?: { path: string; index: number; key: number };
  onLayout?: () => void;
  onError: (error: string) => void;
  initialFragment?: string;
  findHit?: SearchHit;
  findEntryId?: string;
  findDocuments: ReadonlyMap<string, FindMatches>;
}) {
  const [units, setUnits] = useState<ReadingUnit[]>([]),
    [error, setError] = useState(""),
    [cover, setCover] = useState(""),
    [page, setPage] = useState(0);
  const pendingAnchor = useRef<{ id: string; fragment: string } | undefined>(
    undefined,
  );
  const v2 = settings.v2;
  const host = useRef<HTMLDivElement>(null);
  const namespace = useId().replace(/[^A-Za-z0-9-]/g, "") + "-";
  useEffect(() => {
    let live = true;
    if (project.mode === "00" && !v2) {
      setError("");
      return;
    }
    void desktop()
      .invoke("readingUnits", file)
      .then((value) => {
        if (live) {
          setUnits(value);
          setError("");
        }
      })
      .catch((error) => {
        if (live) setError(String(error));
      });
    return () => {
      live = false;
    };
  }, [file, project.revision, project.mode, !!v2]);
  useEffect(() => {
    setCover("");
    if (!v2?.cover || typeof project.metadata?.cover !== "string") return;
    let live = true;
    void desktop()
      .invoke("readResource", file, project.metadata.cover)
      .then((url) => {
        if (live) setCover(url);
      })
      .catch(() => {
        if (live) setCover("");
      });
    return () => {
      live = false;
    };
  }, [file, project.metadata?.cover, v2?.cover, project.revision]);
  const fluid = project.mode === "00" && !v2;
  const single =
    fluid ||
    (!!activeDocument &&
      !project.contents.entries.some(
        ({ path }) => path === activeDocument.path,
      ));
  const standalone = project.format === "markdown";
  const initialJump = useRef(false);
  useEffect(() => {
    if (initialJump.current || !initialFragment || !activeDocument?.path)
      return;
    // Apply the link after the editor's first scroll restoration.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        if (!host.current) return;
        initialJump.current = true;
        scrollToFragment(host.current, initialFragment);
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [initialFragment, activeDocument?.path]);
  useEffect(() => {
    onLayout?.();
  }, [units, activeDocument?.path, activeDocument?.markdown, project.mode]);
  const displayed = single
    ? activeDocument
      ? [
          {
            id: "current",
            position: "",
            path: activeDocument.path,
            markdown: activeDocument.markdown,
          },
        ]
      : []
    : units.map((unit) =>
        unit.path === activeDocument?.path && settings.preview.live_preview
          ? { ...unit, markdown: activeDocument.markdown }
          : unit,
      );
  const previewMath = usePreviewMath(
    !v2 && displayed.some((unit) => mayContainMath(unit.markdown ?? "")),
  );
  const comic = project.mode === "02",
    pair =
      !single && (v2 || comic) && settings.mode.comic.spread_mode === "double",
    width = pair ? 2 : 1;
  const firstSingle = pair && v2?.firstSingle;
  const shift = firstSingle ? 1 : 0;
  const spreads = [
    ...(firstSingle && displayed.length ? [displayed.slice(0, 1)] : []),
    ...Array.from(
      { length: Math.ceil(Math.max(0, displayed.length - shift) / width) },
      (_, index) =>
        displayed.slice(shift + index * width, shift + (index + 1) * width),
    ),
  ];
  const documentView = v2?.previewLayout === "document" && !single;
  const selectedEntry =
    activeEntryId ??
    units.find((unit) => unit.path === activeDocument?.path)?.id;
  const mountedSelection = units.some((unit) => unit.id === selectedEntry);
  useEffect(() => {
    if (
      !selectedEntry ||
      !mountedSelection ||
      single ||
      documentView ||
      initialFragment ||
      findHit
    )
      return;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() =>
        article(selectedEntry)?.scrollIntoView({ block: "start" }),
      );
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedEntry, mountedSelection, single, documentView, initialFragment]);
  function article(id: string) {
    return Array.from(
      host.current?.querySelectorAll<HTMLElement>("[data-entry-id]") ?? [],
    ).find((element) => element.dataset.entryId === id);
  }
  function jump(id: string, fragment = "") {
    const target = article(id);
    if (target) {
      target.focus({ preventScroll: true });
      if (fragment) scrollToFragment(target, fragment);
      else target.scrollIntoView({ block: "start" });
      return;
    }
    const next = spreads.findIndex((items) =>
      items.some((item) => item.id === id),
    );
    if (next < 0 || !documentView) return;
    pendingAnchor.current = { id, fragment };
    setPage(next);
  }
  const focusPage = Math.max(
    0,
    spreads.findIndex((items) =>
      items.some((item) =>
        activeEntryId
          ? item.id === activeEntryId
          : item.path === activeDocument?.path,
      ),
    ),
  );
  useEffect(
    () => setPage(focusPage),
    [focusPage, activeEntryId, activeDocument?.path],
  );
  const matching =
    displayed.find(
      ({ path, id }) =>
        path === findHit?.path && id === (findEntryId ?? activeEntryId),
    ) ?? displayed.find(({ path }) => path === findHit?.path);
  const findPage = matching
    ? spreads.findIndex((items) =>
        items.some((item) => item.id === matching.id),
      )
    : -1;
  useEffect(() => {
    if (documentView && findPage >= 0) setPage(findPage);
  }, [documentView, findPage, findHit]);
  const rendered = useMemo(() => {
    const reserved = reservedSectionNumbers(units.map((unit) => unit.position));
    const viewSettings = {
      ...settings,
      preview: {
        ...settings.preview,
        show_toc: false,
        show_title: fluid || settings.preview.show_title,
      },
    };
    const currentUnits = single
      ? activeDocument
        ? [{ ...activeDocument, id: "current", position: "" }]
        : []
      : units.map((unit) =>
          unit.path === activeDocument?.path && settings.preview.live_preview
            ? { ...unit, markdown: activeDocument.markdown }
            : unit,
        );
    return new Map(
      currentUnits.map((unit, index) => [
        unit.id,
        unit.markdown === null
          ? ""
          : renderPreview(
              unit.markdown,
              viewSettings,
              unit.position,
              project.mode,
              namespace + index + "-",
              unit.path,
              standalone,
              reserved.get(unit.position),
              undefined,
              undefined,
              true,
            ),
      ]),
    );
  }, [
    activeDocument?.path,
    activeDocument?.markdown,
    fluid,
    single,
    namespace,
    previewMath,
    project.mode,
    settings,
    standalone,
    units,
  ]);
  const tocSource = v2StyleValue(settings, "toc.source");
  const titleLinks = useMemo<Map<string, MarkdownHeading[]>>(() => {
    if (!v2 || !settings.preview.show_toc || tocSource === "outline")
      return new Map();
    const lower = Number(v2StyleValue(settings, "toc.heading_min_level"));
    const upper = Number(v2StyleValue(settings, "toc.heading_max_level"));
    return new Map(
      units.map((unit) => [
        unit.id,
        markdownHeadings(
          unit.path === activeDocument?.path && settings.preview.live_preview
            ? activeDocument.markdown
            : (unit.markdown ?? ""),
          true,
        ).filter(({ level }) => lower <= level && level <= upper),
      ]),
    );
  }, [
    units,
    activeDocument?.path,
    activeDocument?.markdown,
    settings,
    v2,
    tocSource,
  ]);
  const maxDepth = Number(v2StyleValue(settings, "toc.max_node_depth"));
  const includeGroups = v2StyleValue(settings, "toc.include_groups") === true;
  const numbering = settings.mode.book.chapter_numbering
    ? String(v2StyleValue(settings, "numbering.format"))
    : "";
  const label = (
    unit: Pick<ReadingUnit, "path" | "position" | "title" | "extensions">,
  ) =>
    numbering
      .replaceAll("{path}", () => unit.position)
      .replaceAll("{index}", () => unit.position.split(".").at(-1) ?? "") +
    (entryDisplayName(unit) ??
      unit.path.split("/").at(-1)?.replace(/\.md$/, "") ??
      "");
  useEffect(() => {
    const pending = pendingAnchor.current;
    if (!pending || !host.current) return;
    const item = article(pending.id);
    if (!item) return;
    pendingAnchor.current = undefined;
    item.focus({ preventScroll: true });
    if (pending.fragment) scrollToFragment(item, pending.fragment);
    else item.scrollIntoView({ block: "start" });
  }, [page, rendered]);
  useEffect(() => {
    let live = true;
    host.current
      ?.querySelectorAll<HTMLImageElement>("img[data-mdk-ref]")
      .forEach((image) => {
        const source =
            image.closest<HTMLElement>("[data-source-path]")!.dataset
              .sourcePath!,
          reference = image.dataset.mdkRef ?? "";
        const target = resolveReference(source, reference, true);
        if (target.kind !== "local") {
          image.alt += t("（外部或不安全媒体未加载）");
          return;
        }
        void desktop()
          .invoke("readResource", file, target.path)
          .then((data) => {
            if (live) image.src = data;
          })
          .catch(() => {
            if (live) image.alt += t("（资源缺失或不可预览）");
          });
      });
    return () => {
      live = false;
    };
  }, [
    units,
    file,
    settings,
    project.mode,
    activeDocument?.path,
    rendered,
    page,
  ]);
  useEffect(() => {
    if (!heading) return;
    const articles = Array.from(
      host.current?.querySelectorAll<HTMLElement>("[data-source-path]") ?? [],
    );
    const article =
      articles.find(
        (node) =>
          node.dataset.sourcePath === heading.path &&
          node.dataset.entryId === activeEntryId,
      ) ?? articles.find((node) => node.dataset.sourcePath === heading.path);
    const target = Array.from(
      article?.querySelectorAll<HTMLElement>("[id]") ?? [],
    ).find((node) => node.id.endsWith("mdk-heading-" + (heading.index + 1)));
    (target ?? article)?.scrollIntoView({ block: "start" });
  }, [heading, units, activeDocument?.markdown]);
  return (
    <div
      className={`reading-preview ${v2 ? "mdk-v2-preview" : ""} ${fluid ? "fluid-reading" : comic || v2 ? "comic-reading fit-" + settings.mode.comic.page_fit : "book-reading"}`}
      ref={host}
      style={
        {
          ...style,
          "--reading-fit":
            comic || v2 ? settings.mode.comic.page_fit : "contain",
          ...(v2
            ? {
                "--v2-canvas": v2.view.color,
                "--v2-spread-gap": v2.view.spreadGap + "px",
                "--v2-document-gap": v2.view.documentGap + "px",
                "--v2-border": v2.view.border + "px",
                "--v2-border-color": v2.view.borderColor,
                "--v2-radius": v2.view.radius + "px",
                "--v2-height": v2.view.height + "px",
              }
            : {}),
        } as CSSProperties
      }
      onClick={(event) => {
        const link = (event.target as Element).closest<HTMLAnchorElement>(
          "a[data-mdk-link]",
        );
        const sourceArticle = link?.closest<HTMLElement>("[data-source-path]");
        if (v2 && link && sourceArticle) {
          const target = resolveReference(
            sourceArticle.dataset.sourcePath!,
            link.dataset.mdkLink ?? "",
          );
          if (target.kind === "local") {
            const current = displayed.find(
              (unit) => unit.id === sourceArticle.dataset.entryId,
            );
            const targetUnit =
              target.path === current?.path
                ? current
                : displayed.find((unit) => unit.path === target.path);
            if (targetUnit) {
              event.preventDefault();
              if (/^\?[^#]/.test(target.suffix)) return;
              const fragment = target.suffix.split("#")[1] ?? "";
              jump(targetUnit.id, fragment);
              return;
            }
          }
        }
        const source = (event.target as Element).closest<HTMLElement>(
          "[data-source-path]",
        )?.dataset.sourcePath;
        if (source)
          followPreviewLink(event, source, standalone, onOpen, onError);
      }}
    >
      {error && <p role="alert">{error}</p>}
      {v2 && !single && (
        <>
          {(v2.projectTitle || v2.creators || v2.description || cover) && (
            <section className="v2-work-info">
              {v2.projectTitle &&
                typeof project.metadata?.title === "string" && (
                  <h2>{project.metadata.title}</h2>
                )}
              {v2.creators && Array.isArray(project.metadata?.creators) && (
                <p>{project.metadata.creators.join(" · ")}</p>
              )}
              {v2.description &&
                typeof project.metadata?.description === "string" && (
                  <p>{project.metadata.description}</p>
                )}
              {cover && <img src={cover} alt={t("封面")} />}
            </section>
          )}
          {settings.preview.show_toc && (
            <nav className="v2-reading-contents" aria-label={t("文稿目录")}>
              {project.contents.entries.map((entry) => {
                const depth = entry.position.split(".").length;
                if (
                  (maxDepth && depth > maxDepth) ||
                  (entry.kind === "group" &&
                    (!includeGroups || tocSource === "headings"))
                )
                  return null;
                const headings = titleLinks.get(entry.id) ?? [];
                return (
                  <div
                    className="v2-toc-node"
                    key={entry.id}
                    style={{
                      paddingInlineStart:
                        includeGroups && tocSource !== "headings"
                          ? (depth - 1) * 12
                          : 0,
                    }}
                  >
                    {entry.kind === "group" || tocSource === "headings" ? (
                      <span>{label(entry)}</span>
                    ) : (
                      <button
                        className="button small"
                        onClick={() => jump(entry.id)}
                      >
                        {label(entry)}
                      </button>
                    )}
                    {headings.map(({ anchor, title, depth }) => (
                      <button
                        key={anchor}
                        className="button small"
                        style={{ marginInlineStart: (depth + 1) * 12 }}
                        onClick={() => jump(entry.id, anchor)}
                      >
                        {title}
                      </button>
                    ))}
                  </div>
                );
              })}
            </nav>
          )}
          {documentView && spreads.length > 1 && (
            <nav
              className="button-row v2-reading-contents"
              aria-label={t("翻页")}
            >
              <button
                className="button small"
                disabled={page <= 0}
                onClick={() => setPage(page - 1)}
              >
                {t("上一页")}
              </button>
              <span>
                {page + 1} / {spreads.length}
              </span>
              <button
                className="button small"
                disabled={page >= spreads.length - 1}
                onClick={() => setPage(page + 1)}
              >
                {t("下一页")}
              </button>
            </nav>
          )}
        </>
      )}
      {!displayed.length && !error && <p>{t("请选择 Markdown 文稿。")}</p>}
      {spreads.map(
        (spread, index) =>
          (!documentView || index === page) && (
            <div
              className={`reading-spread ${pair ? "double" : "single"} ${(comic || v2) && settings.mode.comic.reading_direction === "rtl" ? "rtl" : ""} ${pair && firstSingle && index === 0 ? "v2-first-single" : ""} ${documentView ? "v2-document" : ""}`}
              key={index}
            >
              {spread.map((unit) => (
                <article
                  className="document-paper preview-body reading-unit"
                  key={unit.id}
                  data-entry-id={unit.id}
                  data-source-path={unit.path}
                  tabIndex={-1}
                >
                  {!fluid &&
                    (!v2 || v2.values["document_title.show"] === true) && (
                      <header
                        className="reading-unit-label"
                        data-find-generated=""
                        style={
                          v2
                            ? {
                                fontSize:
                                  Number(
                                    v2StyleValue(
                                      settings,
                                      "document_title.size_scale",
                                    ),
                                  ) * settings.appearance.font_size,
                                fontWeight: Number(
                                  v2StyleValue(
                                    settings,
                                    "document_title.font_weight",
                                  ),
                                ),
                                textAlign: v2StyleValue(
                                  settings,
                                  "document_title.text_align",
                                ) as CSSProperties["textAlign"],
                                color: String(
                                  v2StyleValue(
                                    settings,
                                    "document_title.text_color",
                                  ) ?? settings.colors.text,
                                ),
                                marginBlockStart:
                                  v2StyleValue(
                                    settings,
                                    "document_title.spacing_before",
                                  ) + "em",
                                marginBlockEnd:
                                  v2StyleValue(
                                    settings,
                                    "document_title.spacing_after",
                                  ) + "em",
                              }
                            : undefined
                        }
                      >
                        {v2 ? label(unit) : unit.position + " · " + unit.path}
                      </header>
                    )}
                  {unit.markdown === null ? (
                    <p className="missing-document">
                      {t("文稿缺失或无法按 UTF-8 读取：")}
                      {unit.path}
                    </p>
                  ) : (
                    <ReadingPreviewBody
                      markdown={unit.markdown}
                      html={rendered.get(unit.id) ?? ""}
                      matches={findDocuments.get(unit.path)}
                      hit={unit.id === matching?.id ? findHit : undefined}
                      reveal={(rect) => {
                        if (host.current) revealFindRect(host.current, rect);
                      }}
                    />
                  )}
                </article>
              ))}
            </div>
          ),
      )}
    </div>
  );
}
