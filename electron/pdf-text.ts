import fontkit from "@pdf-lib/fontkit";
import {
  PDFDocument,
  PDFDict,
  PDFName,
  PDFRef,
  PDFRawStream,
  decodePDFRawStream,
} from "pdf-lib";

// Some Chromium CFF subsets reverse-map a shared CJK glyph to its radical
// code point. Restore the source character for copying/search/accessibility;
// this changes neither glyphs nor page geometry. Never guess an ambiguous map.
export function pdfCjkAliases(font: Buffer, text: string) {
  const face = fontkit.create(font);
  if (!("glyphForCodePoint" in face)) throw new Error("不支持字体集合。");
  const used = new Map<number, Set<number>>();
  for (const character of new Set(text)) {
    const point = character.codePointAt(0)!;
    if (point < 32 || !face.hasGlyphForCodePoint(point)) continue;
    const id = face.glyphForCodePoint(point).id,
      points = used.get(id) ?? new Set<number>();
    points.add(point);
    used.set(id, points);
  }
  const aliases = new Map<number, number>();
  for (let point = 0x2e80; point <= 0x2fdf; point++) {
    if (!face.hasGlyphForCodePoint(point)) continue;
    const points = used.get(face.glyphForCodePoint(point).id);
    if (!points?.size) continue;
    if (points.size > 1)
      throw new Error(
        "固定字体将不同的源字符映射到同一 CJK 字形，无法保证 PDF 搜索文本无损；请换用能区分这些字符的字体。",
      );
    const actual = points.values().next().value!;
    if (actual !== point) aliases.set(point, actual);
  }
  return aliases;
}
const utf16hex = (point: number) => {
  const buffer = Buffer.from(String.fromCodePoint(point), "utf16le");
  buffer.swap16();
  return buffer.toString("hex").toUpperCase();
};
export function restorePdfSourceCharacters(
  document: PDFDocument,
  aliases: Map<number, number>,
) {
  const objects = document.context.enumerateIndirectObjects();
  const characterMaps = new Set<string>();
  for (const [, object] of objects) {
    if (
      !(object instanceof PDFDict) ||
      object.get(PDFName.of("Type"))?.toString() !== "/Font"
    )
      continue;
    const map = object.get(PDFName.of("ToUnicode"));
    if (map instanceof PDFRef) characterMaps.add(map.toString());
  }
  const destination = (value: string) =>
    value.length === 4 && aliases.has(parseInt(value, 16))
      ? utf16hex(aliases.get(parseInt(value, 16))!)
      : value;
  for (const [reference, object] of objects) {
    if (
      !(object instanceof PDFRawStream) ||
      !characterMaps.has(reference.toString())
    )
      continue;
    let original: string;
    try {
      original = Buffer.from(decodePDFRawStream(object).decode()).toString(
        "ascii",
      );
    } catch {
      continue;
    }
    if (!original.includes("begincmap") || !original.includes("/CMapType 2"))
      continue;
    let updated = original.replace(
      /(\d+\s+beginbfchar)([\s\S]*?)(endbfchar)/g,
      (_match, opening: string, body: string, closing: string) =>
        opening +
        body.replace(
          /(<[a-f\d]+>)\s+<([a-f\d]+)>/gi,
          (_match, source: string, target: string) =>
            source + " <" + destination(target) + ">",
        ) +
        closing,
    );
    updated = updated.replace(
      /\d+\s+beginbfrange([\s\S]*?)endbfrange/g,
      (_match, body: string) => {
        const entries: string[] = [];
        for (const match of body.matchAll(
          /<([a-f\d]+)>\s*<([a-f\d]+)>\s*(?:<([a-f\d]+)>|\[([^\]]*)\])/gi,
        )) {
          const start = parseInt(match[1], 16),
            end = parseInt(match[2], 16);
          if (end - start > 65535)
            throw new Error("PDF CMap 范围超出支持范围。");
          const array = match[4]
            ? [...match[4].matchAll(/<([a-f\d]+)>/gi)].map((item) => item[1])
            : null;
          for (let value = start; value <= end; value++) {
            const target = array
              ? array[value - start]
              : (BigInt("0x" + match[3]) + BigInt(value - start))
                  .toString(16)
                  .padStart(match[3].length, "0");
            if (!target) throw new Error("PDF CMap 数组不完整。");
            entries.push(
              `<${value.toString(16).padStart(match[1].length, "0")}> <${destination(target)}>`,
            );
          }
        }
        let result = "";
        for (let index = 0; index < entries.length; index += 100) {
          const block = entries.slice(index, index + 100);
          result += `${block.length} beginbfchar\n${block.join("\n")}\nendbfchar\n`;
        }
        return result;
      },
    );
    if (updated !== original)
      document.context.assign(
        reference,
        document.context.flateStream(Buffer.from(updated, "ascii")),
      );
  }
}
