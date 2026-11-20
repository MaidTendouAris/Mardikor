import { t } from "../../shared/i18n";
import {
  previewMediaKind,
  previewMediaMime,
  type AttachmentViewerKind,
} from "../../shared/media-viewer";
import { resolveReference } from "../../shared/references";

export interface EditorMediaTarget {
  kind: AttachmentViewerKind;
  path: string | null;
  reference: string;
  inlineImage?: boolean;
}

export function editorMediaTarget(
  element: Element,
  source: string,
): EditorMediaTarget | undefined {
  const image = element.closest<HTMLImageElement>("img[data-mdk-ref]");
  const link = element.closest<HTMLAnchorElement>("a");
  const reference =
    image?.dataset.mdkRef ??
    element.closest<HTMLElement>("[data-mdk-media-ref]")?.dataset.mdkMediaRef ??
    link?.dataset.mdkLink ??
    link?.getAttribute("href");
  if (!reference) return;
  const target = resolveReference(source, reference, !!image);
  const path = target.kind === "local" ? target.path : null;
  const kind = image
    ? "image"
    : path
      ? previewMediaKind(previewMediaMime(path))
      : undefined;
  if (kind) return { kind, path, reference, inlineImage: !!image };
}

export function viewMediaLabel(kind: AttachmentViewerKind) {
  if (kind === "image") return t("查看图片");
  if (kind === "video") return t("查看视频");
  return kind === "audio" ? t("播放音频") : t("查看附件");
}

export function previewMediaLabel(kind: AttachmentViewerKind) {
  return kind === "audio" || kind === "video"
    ? t("打开新窗口播放")
    : viewMediaLabel(kind);
}
