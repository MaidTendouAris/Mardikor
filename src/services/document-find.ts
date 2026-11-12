import type { MdkProject } from "../../shared/mdk";
import type { MarkdownHeading } from "../../shared/markdown";
import { comparePosition } from "../../shared/outline";
import { isManuscript } from "../../shared/workspace";

export type FindScope = "document" | "branch" | "project";
export interface FindAnchor {
  path: string;
  id?: string;
}
export interface FindOptions {
  scope: FindScope;
  matchCase: boolean;
}
export interface SearchDocument {
  path: string;
  content: string;
}
export interface SearchHit extends SearchDocument {
  start: number;
  end: number;
}

export function searchPaths(
  project: Pick<MdkProject, "files" | "contents" | "format">,
  anchor: FindAnchor,
  scope: FindScope,
) {
  const files = project.files.filter(
    (file) => file.is_text && isManuscript(project, file.path),
  );
  const paths = new Set(files.map((file) => file.path));
  const current = paths.has(anchor.path) ? [anchor.path] : [];
  if (scope === "document" || project.format === "markdown") return current;
  const entries = project.contents.entries
    .filter((entry) => paths.has(entry.path))
    .sort((a, b) => comparePosition(a.position, b.position));
  if (scope === "project")
    return [...new Set([...entries.map((entry) => entry.path), ...paths])];
  const root =
    entries.find(({ id, path }) => id === anchor.id && path === anchor.path) ??
    entries.find(({ path }) => path === anchor.path);
  if (!root) return current;
  return [
    ...new Set([
      ...current,
      ...entries
        .filter(({ position }) => position.startsWith(root.position + "."))
        .map(({ path }) => path),
    ]),
  ];
}

export async function searchDocuments(
  documents: SearchDocument[],
  query: string,
  matchCase: boolean,
  signal?: AbortSignal,
) {
  const matches: {
    document: SearchDocument;
    offsets: number[];
    first: number;
  }[] = [];
  let total = 0;
  if (!query) return { matches, total, length: 0 };
  const pattern = new RegExp(
    query.replace(/[.*+?$^{}()|[\]\\]/g, "\\$&"),
    matchCase ? "gu" : "giu",
  );
  let deadline = performance.now() + 10;
  async function yieldIfNeeded() {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    deadline = performance.now() + 10;
    signal?.throwIfAborted();
  }
  for (const document of documents) {
    signal?.throwIfAborted();
    if (performance.now() > deadline) await yieldIfNeeded();
    const offsets: number[] = [];
    // Monaco stores a leading BOM separately from the first line of text.
    pattern.lastIndex = document.content.charCodeAt(0) === 0xfeff ? 1 : 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(document.content))) {
      offsets.push(match.index);
      if (offsets.length % 1024 === 0 && performance.now() > deadline)
        await yieldIfNeeded();
    }
    if (!offsets.length) continue;
    matches.push({ document, offsets, first: total });
    total += offsets.length;
  }
  return { matches, total, length: query.length };
}

export type SearchResults = Awaited<ReturnType<typeof searchDocuments>>;
export type FindMatches = SearchResults["matches"][number] & { length: number };

export function lowerBound(
  length: number,
  predicate: (index: number) => boolean,
) {
  let first = 0;
  while (first < length) {
    const middle = (first + length) >>> 1;
    if (predicate(middle)) length = middle;
    else first = middle + 1;
  }
  return first;
}

export function lineStarts(content: string) {
  const lines = [0];
  for (const line of content.matchAll(/\r\n|\r|\n/g))
    lines.push(line.index + line[0].length);
  return lines;
}
export function findHeadings(
  content: string,
  headings: MarkdownHeading[],
  offsets: readonly number[],
  activeOffset?: number,
) {
  const matching = new Set<number>();
  let active = -1;
  if (!headings.length || !offsets.length) return { matching, active };
  const lines = lineStarts(content);
  const starts = headings.map(({ line }) => lines[line - 1] ?? Infinity);
  let heading = -1;
  for (const offset of offsets) {
    while (heading + 1 < starts.length && starts[heading + 1] <= offset)
      heading++;
    if (heading < 0) continue;
    const index = headings[heading].index;
    matching.add(index);
    if (offset === activeOffset) active = index;
  }
  return { matching, active };
}
export function searchHit(
  result: SearchResults,
  index: number,
): SearchHit | undefined {
  const match = result.matches.find(
    ({ first, offsets }) => first <= index && index < first + offsets.length,
  );
  if (!match) return;
  const start = match.offsets[index - match.first];
  return { ...match.document, start, end: start + result.length };
}

export function searchPosition(content: string, offset: number) {
  let lineNumber = 1;
  let lineStart = content.charCodeAt(0) === 0xfeff ? 1 : 0;
  const newlines = /\r\n|\r|\n/g;
  let match: RegExpExecArray | null;
  while ((match = newlines.exec(content)) && newlines.lastIndex <= offset) {
    lineNumber++;
    lineStart = match.index + match[0].length;
  }
  return { lineNumber, column: offset - lineStart + 1 };
}

const findOptionsKey = "mardikor.find-options";
export function readFindOptions(): FindOptions {
  try {
    const { scope, matchCase } = JSON.parse(
      localStorage.getItem(findOptionsKey) ?? "{}",
    );
    return {
      scope: scope === "branch" || scope === "project" ? scope : "document",
      matchCase: matchCase === true,
    };
  } catch {
    return { scope: "document", matchCase: false };
  }
}
export function writeFindOptions(options: FindOptions) {
  localStorage.setItem(findOptionsKey, JSON.stringify(options));
}
