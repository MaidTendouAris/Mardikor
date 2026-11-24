export type DocumentPosition = {
  path: string;
  entryId?: string;
  view: "source" | "write" | "preview" | "reader";
  scroll: number;
  cursor?: { line: number; column: number };
  visual?: { start: number; offset: number };
};

export function isDocumentPosition(value: unknown): value is DocumentPosition {
  if (!value || typeof value !== "object") return false;
  const p = value as DocumentPosition;
  const integer = (n: number, min: number) => Number.isSafeInteger(n) && n >= min;
  return typeof p.path === "string" && !!p.path && p.path.length <= 65535 &&
    (p.entryId === undefined || (typeof p.entryId === "string" && p.entryId.length <= 256)) &&
    ["source", "write", "preview", "reader"].includes(p.view) &&
    Number.isFinite(p.scroll) && p.scroll >= 0 && p.scroll <= 1 &&
    (p.cursor === undefined || (!!p.cursor && integer(p.cursor.line, 1) && integer(p.cursor.column, 1))) &&
    (p.visual === undefined || (!!p.visual && integer(p.visual.start, 0) && integer(p.visual.offset, 0)));
}

export function countDocumentCharacters(text: string) {
  let count = text.length;
  for (const _pair of text.matchAll(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g)) count--;
  return count;
}
