import type { ResourceKind } from "./mdk";
export const insertionFormats: Record<
  string,
  { kind: ResourceKind; mime: string }
> = {
  png: { kind: "image", mime: "image/png" },
  jpg: { kind: "image", mime: "image/jpeg" },
  jpeg: { kind: "image", mime: "image/jpeg" },
  gif: { kind: "image", mime: "image/gif" },
  webp: { kind: "image", mime: "image/webp" },
  bmp: { kind: "image", mime: "image/bmp" },
  avif: { kind: "image", mime: "image/avif" },
  svg: { kind: "image", mime: "image/svg+xml" },
  mp3: { kind: "audio", mime: "audio/mpeg" },
  wav: { kind: "audio", mime: "audio/wav" },
  ogg: { kind: "audio", mime: "audio/ogg" },
  flac: { kind: "audio", mime: "audio/flac" },
  aac: { kind: "audio", mime: "audio/aac" },
  m4a: { kind: "audio", mime: "audio/mp4" },
  mp4: { kind: "video", mime: "video/mp4" },
  webm: { kind: "video", mime: "video/webm" },
  pdf: { kind: "other", mime: "application/pdf" },
};
export interface NativeDocumentDrop {
  group?: string;
  token?: string;
  names: string[];
  x: number;
  y: number;
  target: "source" | "write" | "";
  document?: string;
  error?: string;
}
export interface InsertionDraft {
  content: string;
  marker: string;
}
export const resourceRoot = "resources";
export const resourceCategories = [
  "image",
  "video",
  "audio",
  "font",
  "other",
] as const;

export function isResourcePath(path: string) {
  return path === resourceRoot || path.startsWith(resourceRoot + "/");
}

export function isFixedResourceFolder(path: string) {
  return (
    path === resourceRoot ||
    resourceCategories.some(
      (category) => path === resourceRoot + "/" + category,
    )
  );
}
