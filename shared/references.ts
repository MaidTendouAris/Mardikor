import { t } from "./i18n";
import { validatePath, containsControl } from "./schema";
export type ReferenceTarget =
  | { kind: "local"; path: string; suffix: string }
  | { kind: "external"; url: string; media: boolean }
  | { kind: "unsafe"; message: string };
export function resolveReference(
  source: string,
  url: string,
  media = false,
): ReferenceTarget {
  const unsafe = (message: string): ReferenceTarget => ({
    kind: "unsafe",
    message,
  });
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) {
    if (/^https?:\/\//i.test(url) || (!media && /^mailto:/i.test(url)))
      return { kind: "external", url, media };
    return unsafe(t("禁止的引用协议：{0}", url));
  }
  if (url.startsWith("/"))
    return unsafe(t("禁止绝对路径或网络相对引用：{0}", url));
  const split = url.search(/[?#]/),
    raw = split < 0 ? url : url.slice(0, split),
    suffix = split < 0 ? "" : url.slice(split);
  if (!raw) return { kind: "local", path: source, suffix };
  const result = source.split("/").slice(0, -1);
  for (const encoded of raw.split("/")) {
    if (!encoded) return unsafe(t("引用包含空路径段：{0}", url));
    let part: string;
    try {
      part = decodeURIComponent(encoded);
    } catch {
      return unsafe(t("引用的百分号编码无效：{0}", url));
    }
    if (
      part.includes("/") ||
      part.includes("\\") ||
      part.includes(":") ||
      containsControl(part)
    )
      return unsafe(t("引用的解码路径段不安全：{0}", url));
    if (part === ".") continue;
    if (part === "..") {
      if (!result.length) return unsafe(t("引用逃逸工程根目录：{0}", url));
      result.pop();
    } else result.push(part);
  }
  const path = result.join("/");
  try {
    validatePath(path);
  } catch {
    return unsafe(t("引用目标路径无效：{0}", url));
  }
  return { kind: "local", path, suffix };
}
