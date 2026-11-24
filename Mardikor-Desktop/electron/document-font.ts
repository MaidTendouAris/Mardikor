import fontkit from "@pdf-lib/fontkit";
import { t } from "../shared/i18n";
import { isFontFile } from "../shared/fonts";
import { insertionFormat } from "../shared/resources";
import { detectMediaType } from "./media";
import { BUFFERED_ENTRY_LIMIT } from "./archive-io";

export function fontMediaType(name: string, data: Buffer) {
  const mime = detectMediaType(data);
  const expected = /\.otf$/i.test(name) ? "font/otf" : "font/ttf";
  if (!isFontFile(name) || mime !== expected)
    throw new Error(t("请选择有效的独立 OTF 或 TTF 字体文件。"));
  return expected;
}

export function parsedFont(data: Buffer) {
  const font = fontkit.create(data);
  if (!("hasGlyphForCodePoint" in font))
    throw new Error(t("字体集合不能用于固定导出。"));
  // OS/2 embedding flags are technical restrictions, separate from redistribution permission.
  const restriction = (
    font as unknown as {
      "OS/2"?: {
        fsType?: {
          noEmbedding?: boolean;
          noSubsetting?: boolean;
          bitmapOnly?: boolean;
        };
      };
    }
  )["OS/2"]?.fsType;
  if (
    restriction?.noEmbedding ||
    restriction?.noSubsetting ||
    restriction?.bitmapOnly
  )
    throw new Error(
      t("字体的嵌入许可或子集限制不允许此导出，请换用可嵌入的字体。"),
    );
  return font;
}

export function fontDataUrl(name: string, bytes: Buffer) {
  const format = insertionFormat(name);
  if (format?.kind !== "font" || format.mime !== detectMediaType(bytes))
    throw new Error(t("字体文件格式无效。"));
  return `data:${format.mime};base64,${bytes.toString("base64")}`;
}

export function systemFontFace(bytes: Buffer, name: string): Buffer {
  if (bytes.toString("ascii", 0, 4) !== "ttcf") {
    if (["font/otf", "font/ttf"].includes(detectMediaType(bytes) ?? ""))
      return bytes;
    throw new Error(t("系统字体 {0} 的格式不支持嵌入。", name));
  }
  const invalid = () => new Error(t("无法从系统字体集合读取 {0}。", name));
  if (bytes.length < 12) throw invalid();
  const count = bytes.readUInt32BE(8);
  if (count < 1 || count > 256 || 12 + count * 4 > bytes.length)
    throw invalid();
  const collection = fontkit.create(bytes) as unknown as {
    fonts: { postscriptName: string }[];
  };
  const index = collection.fonts.findIndex(
    (font) => font.postscriptName === name,
  );
  if (index < 0 || index >= count) throw invalid();
  const directory = bytes.readUInt32BE(12 + index * 4);
  if (directory > bytes.length - 12) throw invalid();
  const tableCount = bytes.readUInt16BE(directory + 4);
  const directoryEnd = directory + 12 + tableCount * 16;
  if (!tableCount || tableCount > 4095 || directoryEnd > bytes.length)
    throw invalid();
  const tables = [];
  for (let record = directory + 12; record < directoryEnd; record += 16) {
    const tag = bytes.toString("ascii", record, record + 4);
    if (tag === "DSIG") continue;
    const offset = bytes.readUInt32BE(record + 8);
    const size = bytes.readUInt32BE(record + 12);
    if (offset + size > bytes.length) throw invalid();
    tables.push({ record, tag, offset, size, padded: Math.ceil(size / 4) * 4 });
  }
  const head = tables.find((table) => table.tag === "head");
  if (!head || head.size < 12) throw invalid();
  let target = 12 + tables.length * 16;
  const length = tables.reduce((sum, table) => sum + table.padded, target);
  if (length > BUFFERED_ENTRY_LIMIT) throw invalid();
  const face = Buffer.alloc(length);
  bytes.copy(face, 0, directory, directory + 4);
  const power = Math.floor(Math.log2(tables.length));
  const searchRange = 2 ** power * 16;
  face.writeUInt16BE(tables.length, 4);
  face.writeUInt16BE(searchRange, 6);
  face.writeUInt16BE(power, 8);
  face.writeUInt16BE(tables.length * 16 - searchRange, 10);
  let headAdjustment = 0;
  for (const [i, { record, tag, offset, size, padded }] of tables.entries()) {
    const entry = 12 + i * 16;
    bytes.copy(face, entry, record, record + 16);
    face.writeUInt32BE(target, entry + 8);
    bytes.copy(face, target, offset, offset + size);
    if (tag === "head") {
      headAdjustment = target + 8;
      face.writeUInt32BE(0, headAdjustment);
    }
    target += padded;
  }
  let checksum = 0;
  for (let offset = 0; offset < length; offset += 4)
    checksum = (checksum + face.readUInt32BE(offset)) >>> 0;
  face.writeUInt32BE((0xb1b0afba - checksum) >>> 0, headAdjustment);
  return face;
}
