import { useEffect, useRef, useState, useId, type CSSProperties } from "react";
import type { MdkProject, MdkSettings, ReadingUnit } from "../../shared/mdk";
import { desktop } from "../services/desktop";
import { renderPreview } from "../services/preview";
import { resolveReference } from "../../shared/references";
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
  const displayed = fluid
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
  const renderSettings = fluid
    ? {
        ...settings,
        preview: { ...settings.preview, show_toc: false, show_title: true },
      }
    : settings;
  const comic = project.mode === "02",
    pair = comic && settings.mode.comic.spread_mode === "double",
    width = pair ? 2 : 1;
  const spreads = Array.from(
    { length: Math.ceil(displayed.length / width) },
    (_, index) => displayed.slice(index * width, (index + 1) * width),
  );
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
          image.alt += "（外部或不安全媒体未加载）";
          return;
        }
        void desktop()
          .invoke("readResource", file, target.path)
          .then((data) => {
            if (live) image.src = data;
          })
          .catch(() => {
            if (live) image.alt += "（资源缺失或不可预览）";
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
    activeDocument?.markdown,
  ]);
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
      {!displayed.length && !error && <p>请选择 Markdown 文稿。</p>}
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
              style={{ background: settings.colors.background }}
            >
              {!fluid && (
                <header className="reading-unit-label">
                  {unit.position} · {unit.path}
                </header>
              )}
              {unit.markdown === null ? (
                <p className="missing-document">
                  文稿缺失或无法按 UTF-8 读取：{unit.path}
                </p>
              ) : (
                <div
                  dangerouslySetInnerHTML={{
                    __html: renderPreview(
                      unit.markdown,
                      renderSettings,
                      unit.position,
                      project.mode,
                      namespace +
                        (fluid ? "" : "entry-" + units.indexOf(unit) + "-"),
                      unit.path,
                      standalone,
                    ),
                  }}
                />
              )}
            </article>
          ))}
        </div>
      ))}
    </div>
  );
}
