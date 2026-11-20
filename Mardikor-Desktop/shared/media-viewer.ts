import type { AppTheme } from "./desktop";
import type { AppLocale } from "./i18n";
import { insertionFormats } from "./resources";

export type PreviewMediaKind = "image" | "video" | "audio";
export type AttachmentViewerKind = PreviewMediaKind | "attachment";
export type MediaWindowAction = "minimize" | "maximize" | "close";

// These are candidates for the native decoder, not a list of supported codecs.
const additionalFormats: Record<string, string> = {
  ico: "image/x-icon",
  tif: "image/tiff",
  tiff: "image/tiff",
  heic: "image/heic",
  heif: "image/heif",
  jxl: "image/jxl",
  mov: "video/quicktime",
  m4v: "video/mp4",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
  mpeg: "video/mpeg",
  mpg: "video/mpeg",
  ogv: "video/ogg",
  wmv: "video/x-ms-wmv",
  "3gp": "video/3gpp",
  opus: "audio/ogg",
  oga: "audio/ogg",
  aiff: "audio/aiff",
  aif: "audio/aiff",
  wma: "audio/x-ms-wma",
  alac: "audio/mp4",
};

export function previewMediaKind(
  mime: string | undefined,
): PreviewMediaKind | undefined {
  const kind = mime?.split("/", 1)[0];
  return kind === "image" || kind === "video" || kind === "audio"
    ? kind
    : undefined;
}

export function previewMediaMime(path: string) {
  const extension = /\.([^./]+)$/.exec(path)?.[1]?.toLowerCase() ?? "";
  return Object.hasOwn(insertionFormats, extension)
    ? insertionFormats[extension].mime
    : Object.hasOwn(additionalFormats, extension)
      ? additionalFormats[extension]
      : undefined;
}

export interface MediaViewerInfo {
  kind: AttachmentViewerKind;
  name: string;
  path: string;
  bytes: number;
  mime: string;
  src: string | null;
  text?: string;
  truncated?: boolean;
  locale: AppLocale;
  theme: AppTheme;
}

export interface MediaViewerApi {
  info(): Promise<MediaViewerInfo>;
  window(action: MediaWindowAction): Promise<void>;
  onMaximized(callback: (maximized: boolean) => void): () => void;
  save(): Promise<boolean>;
  copyImage(png: Uint8Array): Promise<void>;
}

declare global {
  interface Window {
    mardikorMedia?: MediaViewerApi;
  }
}
