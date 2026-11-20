import { useEffect, useId, useMemo, useRef, type CSSProperties } from "react";
import { t } from "../../shared/i18n";
import {
  entryDisplayName,
  type MdkEntry,
  type MdkSettings,
} from "../../shared/mdk";
import { resolveReference } from "../../shared/references";
import { v2StyleValue } from "../../shared/v2-typography";
import { desktop } from "../services/desktop";
import {
  followPreviewLink,
  scrollToFragment,
} from "../services/document-links";
import type { FindMatches, SearchHit } from "../services/document-find";
import { findLocations, projectFindHit } from "../services/find-mapping";
import { mayContainMath, renderPreview } from "../services/preview";
import { usePreviewMath } from "../services/preview-math";
import { usePreviewPlayback } from "./usePreviewPlayback";
import {
  revealFindRect,
  useMappedFind,
  useMappedMatches,
} from "../services/use-mapped-find";

export function ReadingPreview({
  file,
  mode,
  standalone,
  activeDocument,
  entry,
  reservedSections,
  settings,
  style,
  onOpen,
  onLayout,
  onError,
  heading,
  initialFragment,
  findHit,
  findMatches,
}: {
  file: string;
  mode: string;
  standalone: boolean;
  activeDocument?: { path: string; markdown: string };
  entry?: MdkEntry;
  reservedSections?: ReadonlySet<string>;
  settings: MdkSettings;
  style: CSSProperties;
  onOpen: (path: string, fragment?: string) => void;
  onLayout: () => void;
  onError: (error: string) => void;
  heading?: { path: string; index: number; key: number };
  initialFragment?: string;
  findHit?: SearchHit;
  findMatches?: FindMatches;
}) {
  const host = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const namespace = useId().replace(/[^A-Za-z0-9-]/g, "") + "-";
  const { path, markdown = "" } = activeDocument ?? {};
  const v2 = settings.v2;
  const fluid = mode === "00" && !v2;
  const comic = mode === "02";
  const math = usePreviewMath(!v2 && mayContainMath(markdown));
  const position = entry?.position;
  const html = useMemo(
    () =>
      path === undefined
        ? ""
        : renderPreview(
            markdown,
            settings,
            position,
            mode,
            namespace,
            path,
            standalone,
            reservedSections,
            undefined,
            undefined,
            true,
          ),
    [
      markdown,
      settings,
      position,
      mode,
      namespace,
      path,
      standalone,
      reservedSections,
      math,
    ],
  );
  const markup = useMemo(() => ({ __html: html }), [html]);
  const playback = usePreviewPlayback(content, file, path, html);
  const location = useMemo(
    () =>
      findHit && findHit.path === path
        ? projectFindHit(findHit, markdown)
        : undefined,
    [findHit, path, markdown],
  );
  const locations = useMemo(
    () => findLocations(findMatches, markdown),
    [findMatches, markdown],
  );
  useMappedFind(content, markdown, location, html, (rect) => {
    if (host.current) revealFindRect(host.current, rect);
  });
  useMappedMatches(content, markdown, locations, html);

  useEffect(() => {
    onLayout();
  }, [path, html]);
  const initialJump = useRef(false);
  useEffect(() => {
    if (!path || !initialFragment || initialJump.current) return;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        if (content.current) scrollToFragment(content.current, initialFragment);
        initialJump.current = true;
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [path, initialFragment]);
  useEffect(() => {
    if (!heading || heading.path !== path || !content.current) return;
    scrollToFragment(content.current, "mdk-heading-" + (heading.index + 1));
  }, [heading, path, html]);
  useEffect(() => {
    if (!path) return;
    let live = true;
    const resources = new Map<string, Promise<string>>();
    for (const image of content.current?.querySelectorAll<HTMLImageElement>(
      "img[data-mdk-ref]",
    ) ?? []) {
      const target = resolveReference(path, image.dataset.mdkRef ?? "", true);
      if (target.kind !== "local") {
        image.alt += t("（外部或不安全媒体未加载）");
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
          if (live) image.alt += t("（资源缺失或不可预览）");
        },
      );
    }
    return () => {
      live = false;
    };
  }, [file, path, html]);

  const caption =
    position && settings.mode.book.chapter_numbering
      ? String(v2StyleValue(settings, "numbering.format"))
          .replaceAll("{path}", () => position)
          .replaceAll("{index}", () => position.split(".").at(-1) ?? "")
      : "";
  const title =
    (entry && entryDisplayName(entry)) ??
    path?.split("/").at(-1)?.replace(/\.md$/i, "");
  return (
    <div
      className={
        "reading-preview" +
        (v2 ? " mdk-v2-preview" : "") +
        (fluid
          ? " fluid-reading"
          : comic || v2
            ? " comic-reading fit-" + settings.mode.comic.page_fit
            : " book-reading")
      }
      ref={host}
      style={
        {
          ...style,
          "--reading-fit":
            comic || v2 ? settings.mode.comic.page_fit : "contain",
          ...(v2 && {
            "--v2-canvas": v2.view.color,
            "--v2-border": v2.view.border + "px",
            "--v2-border-color": v2.view.borderColor,
            "--v2-radius": v2.view.radius + "px",
            "--v2-height": v2.view.height + "px",
          }),
        } as CSSProperties
      }
    >
      {path ? (
        <div
          className={
            "reading-spread" +
            (v2?.previewLayout === "document" ? " v2-document" : "")
          }
        >
          <article
            className="document-paper preview-body reading-unit"
            data-entry-id={entry?.id}
            data-source-path={path}
            tabIndex={-1}
            onClick={(event) =>
              followPreviewLink(event, path, standalone, onOpen, onError)
            }
          >
            {v2?.values["document_title.show"] === true && (
              <header
                className="reading-unit-label"
                data-find-generated=""
                style={{
                  fontSize:
                    Number(
                      v2StyleValue(settings, "document_title.size_scale"),
                    ) * settings.appearance.font_size,
                  fontWeight: Number(
                    v2StyleValue(settings, "document_title.font_weight"),
                  ),
                  textAlign: v2StyleValue(
                    settings,
                    "document_title.text_align",
                  ) as CSSProperties["textAlign"],
                  color: String(
                    v2StyleValue(settings, "document_title.text_color") ??
                      settings.colors.text,
                  ),
                  marginBlockStart:
                    v2StyleValue(settings, "document_title.spacing_before") +
                    "em",
                  marginBlockEnd:
                    v2StyleValue(settings, "document_title.spacing_after") +
                    "em",
                }}
              >
                {caption}
                {title}
              </header>
            )}
            <div key={path} ref={content} dangerouslySetInnerHTML={markup} />
            {playback}
          </article>
        </div>
      ) : (
        <p>{t("请选择 Markdown 文稿。")}</p>
      )}
    </div>
  );
}
