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
  oga: { kind: "audio", mime: "audio/ogg" },
  opus: { kind: "audio", mime: "audio/ogg" },
  flac: { kind: "audio", mime: "audio/flac" },
  aac: { kind: "audio", mime: "audio/aac" },
  m4a: { kind: "audio", mime: "audio/mp4" },
  mp4: { kind: "video", mime: "video/mp4" },
  m4v: { kind: "video", mime: "video/mp4" },
  mov: { kind: "video", mime: "video/quicktime" },
  webm: { kind: "video", mime: "video/webm" },
  ogv: { kind: "video", mime: "video/ogg" },
  otf: { kind: "font", mime: "font/otf" },
  ttf: { kind: "font", mime: "font/ttf" },
  ttc: { kind: "font", mime: "font/ttf" },
  woff: { kind: "font", mime: "font/woff" },
  woff2: { kind: "font", mime: "font/woff2" },
  pdf: { kind: "other", mime: "application/pdf" },
};

export function insertionFormat(name: string) {
  const extension = /\.([^./]+)$/.exec(name)?.[1]?.toLowerCase() ?? "";
  return Object.hasOwn(insertionFormats, extension)
    ? insertionFormats[extension]
    : undefined;
}
export interface NativeDocumentDrag {
  group?: string;
  x: number;
  y: number;
  target: "source" | "write" | "";
  document?: string;
}
export interface NativeDocumentDrop extends NativeDocumentDrag {
  token?: string;
  names: string[];
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
