import type Token from "markdown-it/lib/token.mjs";
import { createMarkdownParser } from "../../shared/markdown-parser";
import { requiresSourceMode } from "../../shared/markdown";
import { previewTextLimit } from "./document-size";

type References = Record<string, { href: string; title: string }>;
export type TextPage = {
  start: number;
  line: number;
  literal?: boolean;
  readOnly?: boolean;
  tableHeader?: string;
};
export type DocumentPages = {
  length: number;
  pages: TextPage[];
  references?: References;
  notes?: string;
  headings?: { line: number; level: number }[];
};

export type EditPageWindow = { first: number; last: number };

function writablePage(layout: DocumentPages, index: number) {
  const page = layout.pages[index];
  return !!page && !page.readOnly;
}

export function editWindowAt(layout: DocumentPages, index: number) {
  if (!writablePage(layout, index)) return undefined;
  return {
    first: writablePage(layout, index - 1) ? index - 1 : index,
    last: writablePage(layout, index + 1) ? index + 1 : index,
  };
}

export function shiftEditWindow(
  layout: DocumentPages,
  window: EditPageWindow,
  direction: -1 | 1,
) {
  if (direction === 1 && writablePage(layout, window.last + 1))
    return {
      first: Math.max(window.first, window.last - 1),
      last: window.last + 1,
    };
  if (direction === -1 && writablePage(layout, window.first - 1))
    return {
      first: window.first - 1,
      last: Math.min(window.last, window.first + 1),
    };
  return window;
}

const blocks = createMarkdownParser(true, false).set({ html: true });
const eol = /\r\n|\r|\n/g;
export function lineBreaks(text: string) {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    if (char === 10 || (char === 13 && text.charCodeAt(i + 1) !== 10)) count++;
  }
  return count;
}

// Exceptionally long blocks stay intact on disk. Their preview is bounded,
// and no visual editor is allowed to serialize a fragment of such a block.
function boundedRanges(
  text: string,
  start: number,
  end: number,
  length: number,
  line: number,
) {
  const result: TextPage[] = [];
  let continued = false;
  while (start < end) {
    let next = Math.min(start + length, end);
    let literal = false;
    if (next < end) {
      const before = text.slice(start, next);
      const boundary = /(?:\r\n|\r(?!\n)|\n)[\t ]*(?:\r\n|\r(?!\n)|\n)/g;
      let cut = 0;
      for (const match of before.matchAll(boundary))
        cut = match.index + match[0].length;
      if (cut >= length / 2) next = start + cut;
      else {
        literal = true;
        if (text[next - 1] === "\r" && text[next] === "\n") next--;
        const last = text.charCodeAt(next - 1);
        if (last >= 0xd800 && last <= 0xdbff) next--;
      }
    }
    result.push({
      start,
      line,
      readOnly: true,
      ...(literal || continued ? { literal: true } : {}),
    });
    continued = literal;
    line += lineBreaks(text.slice(start, next));
    start = next;
  }
  return result;
}

export function paginateMarkdown(text: string, length: number): DocumentPages {
  if (text.length > previewTextLimit) {
    return { length, pages: boundedRanges(text, 0, text.length, length, 1) };
  }
  const offsets = [0];
  for (const match of text.matchAll(eol))
    offsets.push(match.index + match[0].length);
  const tokens: Token[] = [];
  const env: { references?: References } = {};
  blocks.block.parse(
    text.replace(/\r\n?/g, "\n").replaceAll("\0", "\ufffd"),
    blocks,
    env,
    tokens,
  );
  const starts = [
    ...new Set(
      tokens
        .filter((t) => t.level === 0 && t.map && t.nesting !== -1)
        .map((t) => t.map![0]),
    ),
  ].sort((a, b) => a - b);
  const tableEnds = new Map(
    tokens.flatMap((token) =>
      token.type === "table_open" && token.level === 0 && token.map
        ? [[token.map[0], token.map[1]] as const]
        : [],
    ),
  );
  const notes: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== "footnote_reference_open" || tokens[i].level !== 0)
      continue;
    let first = Infinity;
    let last = 0;
    for (
      i++;
      i < tokens.length && tokens[i].type !== "footnote_reference_close";
      i++
    ) {
      if (tokens[i].map) {
        first = Math.min(first, tokens[i].map![0]);
        last = Math.max(last, tokens[i].map![1]);
      }
    }
    if (first < last) notes.push(text.slice(offsets[first], offsets[last]));
  }
  const pages: TextPage[] = [];
  const offset = (line: number) => offsets[line] ?? text.length;
  let start = 0;
  let end = 0;
  for (let index = 0; index < starts.length; index++) {
    const from = index === 0 ? 0 : starts[index];
    const to = starts[index + 1] ?? offsets.length;
    const oversized = offset(to) - offset(from) > Math.max(length * 2, 24000);
    const tableStart = starts[index];
    const tableEnd = tableEnds.get(tableStart);
    if (
      oversized &&
      tableEnd !== undefined &&
      tableEnd > tableStart + 2 &&
      offset(tableStart + 2) - offset(tableStart) < length
    ) {
      const header = text.slice(offset(tableStart), offset(tableStart + 2));
      if (end > start && offset(tableStart + 3) - offset(start) > length) {
        pages.push({ start: offset(start), line: start + 1 });
        start = from;
      }
      let row = tableStart;
      while (row < tableEnd) {
        const continuation = row > tableStart;
        const first = continuation ? row : start;
        pages.push({
          start: offset(first),
          line: first + 1,
          readOnly: true,
          ...(continuation ? { tableHeader: header } : {}),
        });
        let next = continuation ? row + 1 : tableStart + 3;
        const overhead = continuation ? header.length : 0;
        while (
          next < tableEnd &&
          offset(next + 1) - offset(first) + overhead <= length
        )
          next++;
        row = next;
      }
      if (offset(to) - offset(tableEnd) > length)
        pages.push(
          ...boundedRanges(
            text,
            offset(tableEnd),
            offset(to),
            length,
            tableEnd + 1,
          ),
        );
      start = end = to;
      continue;
    }
    if (end > start && offset(to) - offset(start) > length) {
      pages.push({ start: offset(start), line: start + 1 });
      start = from;
    }
    if (oversized) {
      pages.push(
        ...boundedRanges(text, offset(from), offset(to), length, from + 1).map(
          (page) => ({ ...page, literal: true }),
        ),
      );
      start = to;
    }
    end = to;
  }
  if (!pages.length || offset(end) > offset(start))
    pages.push({ start: offset(start), line: start + 1 });
  for (let i = 0; i < pages.length; i++) {
    if (pages[i].readOnly) continue;
    const body = text.slice(pages[i].start, pages[i + 1]?.start);
    if (
      (env.references && body.includes("[")) ||
      (/[<[:]|^---/.test(body) && requiresSourceMode(body))
    )
      pages[i].readOnly = true;
  }
  const headings = tokens
    .filter((t) => t.type === "heading_open" && t.map)
    .map((t) => ({ line: t.map![0] + 1, level: Number(t.tag.slice(1)) }));
  return {
    length,
    pages,
    references: env.references,
    notes: notes.length ? notes.join("\n\n") : undefined,
    headings,
  };
}

export function replacePage(
  text: string,
  layout: DocumentPages,
  index: number,
  markdown: string,
  last = index,
) {
  const start = layout.pages[index].start;
  const end = layout.pages[last + 1]?.start ?? text.length;
  const original = text.slice(start, end);
  // Keep the exact surrounding separator and line ending convention. In
  // particular a Tiptap serializer usually strips the trailing blank lines.
  const edge = /(?:\r\n|\r|\n)[\t \r\n]*$/.exec(original)?.[0] ?? "";
  const newline =
    original.includes("\r\n") || (!original && text.includes("\r\n"))
      ? "\r\n"
      : "\n";
  const body = markdown.replace(/\r\n?|\n/g, newline).replace(/[\r\n]+$/, "");
  const bom =
    original.startsWith("\ufeff") && !body.startsWith("\ufeff") ? "\ufeff" : "";
  const tail =
    last + 1 < layout.pages.length && lineBreaks(edge) < 2
      ? newline + newline
      : edge;
  const value = bom + body + (body ? tail : "");
  const delta = value.length - original.length;
  const lines = lineBreaks(value) - lineBreaks(original);
  return {
    content: text.slice(0, start) + value + text.slice(end),
    pageText: value,
    layout: {
      ...layout,
      // The live outline will supply updated heading ordinals after a change.
      headings: !lines
        ? layout.headings
        : layout.headings?.map((heading) =>
            heading.line >= (layout.pages[last + 1]?.line ?? Infinity)
              ? { ...heading, line: heading.line + lines }
              : heading,
          ),
      pages: [
        ...layout.pages.slice(0, index + 1),
        ...layout.pages.slice(last + 1).map((page) => ({
          ...page,
          start: page.start + delta,
          line: page.line + lines,
        })),
      ],
    },
  };
}

export function pageAtLine(pages: TextPage[], line: number) {
  let lo = 0,
    hi = pages.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (pages[mid].line <= line) lo = mid + 1;
    else hi = mid;
  }
  return Math.max(0, lo - 1);
}

export function replacePages(
  text: string,
  layout: DocumentPages,
  changes: { index: number; text: string }[],
) {
  let content = text;
  let pagination = layout;
  const applied = changes.map(({ index, text }) => {
    const next = replacePage(content, pagination, index, text);
    content = next.content;
    pagination = next.layout;
    return { index, text: next.pageText };
  });
  return { content, pagination, applied };
}

export function headingOffsetAtLine(
  headings: { line: number }[],
  line: number,
) {
  let lo = 0,
    hi = headings.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (headings[mid].line < line) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
