import fs from "node:fs";
import path from "node:path";
import { insertionFormats } from "../shared/resources";
import { checkMedia, detectMediaType, assertPassiveSvg } from "./media";

export type InsertionSource = string | { name: string; bytes: Buffer };

export function loadInsertionAssets(sources: InsertionSource[]) {
  if (!Array.isArray(sources) || !sources.length || sources.length > 16)
    throw new Error("一次最多插入 16 个文件。");
  let total = 0;
  return sources.map((source) => {
    const name = path.basename(
        typeof source === "string" ? source : source.name,
      ),
      extension = path.extname(name).slice(1).toLowerCase(),
      format = Object.hasOwn(insertionFormats, extension)
        ? insertionFormats[extension]
        : undefined;
    if (!format)
      throw new Error(
        "不支持插入此类型：" + name + "。支持图片、音视频和 PDF。",
      );
    const info = typeof source === "string" ? fs.statSync(source) : null;
    if (info && !info.isFile()) throw new Error("不能插入目录：" + name);
    total += typeof source === "string" ? info!.size : source.bytes.length;
    if (total > 64 * 1024 * 1024)
      throw new Error("一次拖入的文件总量不能超过 64 MiB。");
    const bytes =
      typeof source === "string" ? fs.readFileSync(source) : source.bytes;
    checkMedia(name, bytes);
    const mime =
      format.mime === "application/pdf" &&
      bytes.subarray(0, 5).toString() === "%PDF-"
        ? "application/pdf"
        : detectMediaType(bytes);
    if (mime !== format.mime)
      throw new Error("文件内容与受支持格式不符：" + name);
    if (mime === "image/svg+xml") assertPassiveSvg(bytes);
    return { name, bytes, kind: format.kind };
  });
}
