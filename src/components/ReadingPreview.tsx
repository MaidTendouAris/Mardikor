import { t } from "../../shared/i18n";
import {
  useEffect,
  useRef,
  useState,
  useId,
  useMemo,
  type CSSProperties,
} from "react";
import type { MdkProject, MdkSettings, ReadingUnit } from "../../shared/mdk";
import { desktop } from "../services/desktop";
import { mayContainMath, renderPreview } from "../services/preview";
import { usePreviewMath } from "../services/preview-math";
import type { FindMatches, SearchHit } from "../services/document-find";
import { findLocations, projectFindHit } from "../services/find-mapping";
import { revealFindRect, useMappedFind, useMappedMatches } from "../services/use-mapped-find";

function ReadingPreviewBody({ markdown, html, matches, hit, reveal }: {
  markdown: string;
  html: string;
  matches?: FindMatches;
  hit?: SearchHit;
  reveal: (rect: DOMRect) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const location = useMemo(() => hit && projectFindHit(hit, markdown), [hit, markdown]);
  const locations = useMemo(() => findLocations(matches, markdown), [matches, markdown]);
  useMappedFind(root, markdown, location, html, reveal);
  useMappedMatches(root, markdown, locations, html);
  return <div ref={root} dangerouslySetInnerHTML={{ __html: html }} />;
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
  heading,
  onLayout,
  onError,
  initialFragment,
  findHit,
  findDocuments,
}: {
  file: string;
  project: MdkProject;
  settings: MdkSettings;
  style: CSSProperties;
  onOpen: (path: string) => void;
  activeDocument?: { path: string; markdown: string };
  heading?: { path: string; index: number; key: number };
  onLayout?: () => void;
  onError: (error: string) => void;
  initialFragment?: string;
  findHit?: SearchHit;
  findDocuments: ReadonlyMap<string, FindMatches>;
}) {
  const [units, setUnits] = useState<ReadingUnit[]>([]),
    [error, setError] = useState("");
  const host = useRef<HTMLDivElement>(null);
  const namespace = useId().replace(/[^A-Za-z0-9-]/g, "") + "-";
  useEffect(() => {
    let live = true;
    if (project.mode === "00") {
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
  }, [file, project.revision, project.mode]);
  const fluid = project.mode === "00";
  const single = fluid || (!!activeDocument &&
    !project.contents.entries.some(({ path }) => path === activeDocument.path));
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
    : units;
  const previewMath = usePreviewMath(
    displayed.some((unit) => mayContainMath(unit.markdown ?? "")),
  );
  const comic = project.mode === "02",
    pair = comic && settings.mode.comic.spread_mode === "double",
    width = pair ? 2 : 1;
  const spreads = Array.from(
    { length: Math.ceil(displayed.length / width) },
    (_, index) => displayed.slice(index * width, (index + 1) * width),
  );
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
      : units;
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
  const matching = displayed.find(({ path }) => path === findHit?.path);
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
  }, [units, file, settings, project.mode, activeDocument?.path, rendered]);
  useEffect(() => {
    if (!heading) return;
    const article = Array.from(
      host.current?.querySelectorAll<HTMLElement>("[data-source-path]") ?? [],
    ).find((node) => node.dataset.sourcePath === heading.path);
    const target = Array.from(
      article?.querySelectorAll<HTMLElement>("[id]") ?? [],
    ).find((node) => node.id.endsWith("mdk-heading-" + (heading.index + 1)));
    (target ?? article)?.scrollIntoView({ block: "start" });
  }, [heading, units, activeDocument?.markdown]);
  return (
    <div
      className={`reading-preview ${fluid ? "fluid-reading" : comic ? "comic-reading fit-" + settings.mode.comic.page_fit : "book-reading"}`}
      ref={host}
      style={
        {
          ...style,
          "--reading-fit": comic ? settings.mode.comic.page_fit : "contain",
        } as CSSProperties
      }
      onClick={(event) => {
        const source = (event.target as Element).closest<HTMLElement>(
          "[data-source-path]",
        )?.dataset.sourcePath;
        if (source)
          followPreviewLink(event, source, standalone, onOpen, onError);
      }}
    >
      {error && <p role="alert">{error}</p>}
      {!displayed.length && !error && <p>{t("请选择 Markdown 文稿。")}</p>}
      {spreads.map((spread, index) => (
        <div
          className={`reading-spread ${pair ? "double" : "single"} ${comic && settings.mode.comic.reading_direction === "rtl" ? "rtl" : ""}`}
          key={index}
        >
          {spread.map((unit) => (
            <article
              className="document-paper preview-body reading-unit"
              key={unit.id}
              data-entry-id={unit.id}
              data-source-path={unit.path}
            >
              {!fluid && (
                <header className="reading-unit-label">
                  {unit.position} · {unit.path}
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
                  reveal={(rect) => { if (host.current) revealFindRect(host.current, rect); }}
                />
              )}
            </article>
          ))}
        </div>
      ))}
    </div>
  );
}
