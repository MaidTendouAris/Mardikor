import { t } from "../shared/i18n";
export function detectMediaType(data: Buffer): string | undefined {
  const header = data.subarray(0, 64);
  const ascii = header.toString("latin1");
  const hex = header.toString("hex");
  if (hex.startsWith("89504e470d0a1a0a")) return "image/png";
  if (hex.startsWith("ffd8ff")) return "image/jpeg";
  if (/^GIF8[79]a/.test(ascii)) return "image/gif";
  if (ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP")
    return "image/webp";
  if (ascii.startsWith("BM")) return "image/bmp";
  if (hex.startsWith("49492a00") || hex.startsWith("4d4d002a"))
    return "image/tiff";
  if (
    /^(?:\s|<\?xml[^>]*>)*<svg[\s>]/i.test(
      data.subarray(0, 4096).toString("utf8"),
    )
  )
    return "image/svg+xml";
  if (ascii.slice(4, 8) === "ftyp") {
    if (/M4A|M4B/.test(ascii.slice(8))) return "audio/mp4";
    if (/avif|avis/.test(ascii.slice(8))) return "image/avif";
    if (/heic|heix|mif1/.test(ascii.slice(8))) return "image/heic";
    return "video/mp4";
  }
  if (hex.startsWith("1a45dfa3")) return "video/webm";
  if (ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WAVE")
    return "audio/wav";
  if (ascii.startsWith("fLaC")) return "audio/flac";
  if (ascii.startsWith("OggS")) return "audio/ogg";
  if (data[0] === 0xff && (data[1] & 0xf6) === 0xf0) return "audio/aac";
  if (
    ascii.startsWith("ID3") ||
    (data[0] === 0xff && (data[1] & 0xe0) === 0xe0)
  )
    return "audio/mpeg";
  if (ascii.startsWith("wOFF")) return "font/woff";
  if (ascii.startsWith("wOF2")) return "font/woff2";
  if (ascii.startsWith("OTTO")) return "font/otf";
  if (hex.startsWith("00010000") || ascii.startsWith("ttcf")) return "font/ttf";
  return undefined;
}

const expected: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  tif: "image/tiff",
  tiff: "image/tiff",
  svg: "image/svg+xml",
  avif: "image/avif",
  heic: "image/heic",
  mp4: "video/mp4",
  webm: "video/webm",
  wav: "audio/wav",
  flac: "audio/flac",
  ogg: "audio/ogg",
  mp3: "audio/mpeg",
  aac: "audio/aac",
  m4a: "audio/mp4",
  woff: "font/woff",
  woff2: "font/woff2",
  otf: "font/otf",
  ttf: "font/ttf",
  ttc: "font/ttf",
};
export function checkMedia(name: string, data: Buffer) {
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  const type = expected[extension];
  if (type && detectMediaType(data) !== type)
    throw new Error(t("资源的扩展名与实际文件格式不一致：{0}", name));
}
export function assertPassiveSvg(data: Buffer) {
  if (
    detectMediaType(data) === "image/svg+xml" &&
    /<\s*(?:script|foreignObject|iframe|object|embed)\b|\bon\w+\s*=|(?:href|src)\s*=\s*["']\s*(?!#)|@import|url\(\s*["']?\s*(?!#)/i.test(
      data.toString("utf8"),
    )
  )
    throw new Error(t("SVG 含活动内容或外部引用，不能插入或预览。"));
}

// Check declared raster dimensions before the native decoder can allocate a
// large pixel buffer. Full decoding/CRC checks still run afterward.
export function publicationRasterSize(data: Buffer) {
  const type = detectMediaType(data);
  let width = 0,
    height = 0;
  if (type === "image/png" && data.length >= 24) {
    width = data.readUInt32BE(16);
    height = data.readUInt32BE(20);
  } else if (type === "image/jpeg") {
    let offset = 2;
    while (offset + 4 <= data.length) {
      if (data[offset++] !== 0xff) throw new Error(t("JPEG 标记损坏。"));
      while (data[offset] === 0xff) offset++;
      const marker = data[offset++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
      if (offset + 2 > data.length) break;
      const length = data.readUInt16BE(offset);
      if (length < 2 || offset + length > data.length)
        throw new Error(t("JPEG 数据被截断。"));
      if (
        [
          0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
          0xce, 0xcf,
        ].includes(marker)
      ) {
        if (length < 8) throw new Error(t("JPEG 尺寸段损坏。"));
        height = data.readUInt16BE(offset + 3);
        width = data.readUInt16BE(offset + 5);
        break;
      }
      offset += length;
    }
  }
  if (!width || !height || width * height > 40000000)
    throw new Error(t("图片尺寸无效或超过四千万像素，未进行解码。"));
  if (type === "image/png") {
    let offset = 8;
    while (offset + 12 <= data.length) {
      const length = data.readUInt32BE(offset),
        chunk = data.toString("ascii", offset + 4, offset + 8);
      if (offset + length + 12 > data.length)
        throw new Error(t("PNG 数据被截断。"));
      if (["acTL", "fcTL", "fdAT"].includes(chunk))
        throw new Error(
          t("动画 PNG 不能保证固定帧导出，请转换为静态 PNG 或 JPEG。"),
        );
      offset += length + 12;
      if (chunk === "IEND") break;
    }
  }
  return { width, height };
}
