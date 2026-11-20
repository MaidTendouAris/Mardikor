import type { AppTheme } from "./desktop";
import type { AppLocale } from "./i18n";
import { insertionFormat } from "./resources";

export type PreviewMediaKind = "image" | "video" | "audio";
export type PlaybackKind = Exclude<PreviewMediaKind, "image">;
export const defaultMediaVolume = 0.3;
export type AttachmentViewerKind = PreviewMediaKind | "attachment";
export type MediaWindowAction = "minimize" | "maximize" | "close";

export function formatPlaybackTime(seconds: number) {
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = String(whole % 60).padStart(2, "0");
  if (minutes < 60) return `${minutes}:${rest}`;
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${rest}`;
}

// These are candidates for the native decoder, not a list of supported codecs.
const additionalFormats: Record<string, string> = {
  ico: "image/x-icon",
  tif: "image/tiff",
  tiff: "image/tiff",
  heic: "image/heic",
  heif: "image/heif",
  jxl: "image/jxl",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
  mpeg: "video/mpeg",
  mpg: "video/mpeg",
  wmv: "video/x-ms-wmv",
  "3gp": "video/3gpp",
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
  return (
    insertionFormat(path)?.mime ??
    (Object.hasOwn(additionalFormats, extension)
      ? additionalFormats[extension]
      : undefined)
  );
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
