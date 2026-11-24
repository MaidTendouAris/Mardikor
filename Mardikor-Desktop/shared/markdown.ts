import {
  createMarkdownParser,
  createMdkMarkdownParser,
} from "./markdown-parser";
import { headingText, v2HeadingAnchors } from "./mdk-anchors";

const parser = createMarkdownParser();
const mdkParser = createMdkMarkdownParser(false);
export interface MarkdownHeading {
  index: number;
  level: number;
  depth: number;
  title: string;
  line: number;
  anchor?: string;
  section?: {
    parent: number;
    end?: { line: number; index: number };
    previous?: number;
    next?: number;
    setext: boolean;
  };
}
export function markdownHeadings(
  source: string,
  v2 = false,
): MarkdownHeading[] {
  const tokens = (v2 ? mdkParser : parser).parse(source, {}),
    anchors = v2 ? v2HeadingAnchors(tokens) : undefined,
    headings: MarkdownHeading[] = [],
    stack: number[] = [],
    sections: MarkdownHeading[] = [],
    siblings = new Map<string, MarkdownHeading>();
  // Keep a YAML preamble in place even when v2 renders it as CommonMark.
  const preamble =
    v2 && /^\ufeff?---[\t ]*(?:\r\n|\r|\n)/.test(source)
      ? parser.parse(source, {})[0]
      : undefined;
  const preambleEnd =
    preamble?.type === "mdk_front_matter" ? preamble.map![1] : 0;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type !== "heading_open" || !token.map) continue;
    const level = Number(token.tag.slice(1));
    while (stack.length && stack.at(-1)! >= level) stack.pop();
    const heading: MarkdownHeading = {
      index: headings.length,
      level,
      depth: stack.length,
      title: v2
        ? headingText(tokens[i + 1]?.children ?? [])
        : parser.renderer.renderInlineAsText(
            tokens[i + 1]?.children ?? [],
            parser.options,
            {},
          ),
      line: token.map[0] + 1,
      ...(anchors ? { anchor: anchors.get(i) } : {}),
    };
    headings.push(heading);
    if (token.level === 0 && token.map[0] >= preambleEnd) {
      while (sections.length && sections.at(-1)!.level >= level)
        sections.pop()!.section!.end = {
          line: heading.line,
          index: heading.index,
        };
      const parent = sections.at(-1)?.index ?? -1;
      const key = `${parent}:${level}`;
      const previous = siblings.get(key);
      heading.section = {
        parent,
        previous: previous?.index,
        setext: token.markup === "=" || token.markup === "-",
      };
      if (previous) previous.section!.next = heading.index;
      siblings.set(key, heading);
      sections.push(heading);
    }
    stack.push(level);
  }
  return headings;
}

export type SectionSide = "before" | "after";

export function canMoveMarkdownSection(
  from: MarkdownHeading,
  target: MarkdownHeading,
  side: SectionSide,
) {
  return (
    !!from.section &&
    !!target.section &&
    from.index !== target.index &&
    from.level === target.level &&
    from.section.parent === target.section.parent &&
    (side === "before"
      ? from.section.next !== target.index
      : from.section.previous !== target.index)
  );
}

export function moveMarkdownSection(
  source: string,
  headings: MarkdownHeading[],
  from: MarkdownHeading,
  target: MarkdownHeading,
  side: SectionSide,
  v2 = false,
) {
  if (!canMoveMarkdownSection(from, target, side)) return;
  const bom = source.startsWith("\ufeff") ? 1 : 0;
  const offsets = [bom];
  for (const ending of source.matchAll(/\r\n|\r|\n/g))
    offsets.push(ending.index + ending[0].length);
  const offset = (line?: number) =>
    line === undefined ? source.length : offsets[line - 1];
  const start = offset(from.line);
  const end = offset(from.section!.end?.line);
  const insertion = offset(
    side === "before" ? target.line : target.section!.end?.line,
  );
  if (insertion >= start && insertion <= end) return;
  const upward = insertion < start;
  const first = upward ? insertion : start;
  const middle = upward ? start : end;
  const last = upward ? end : insertion;
  const sections = headings.filter((heading) => heading.section);
  const index = (position: number) =>
    position === source.length
      ? sections.length
      : sections.findIndex((heading) => offset(heading.line) === position);
  const i = index(first),
    j = index(middle),
    k = index(last);
  if (i < 0 || j <= i || k <= j) return;
  const expected = [
    ...sections.slice(0, i),
    ...sections.slice(j, k),
    ...sections.slice(i, j),
    ...sections.slice(k),
  ];
  const destination = expected.indexOf(from);
  let left = source.slice(first, middle),
    right = source.slice(middle, last);
  const prefix = source.slice(0, first),
    suffix = source.slice(last);
  if (last === source.length && !/[\r\n]$/.test(right)) {
    // Reuse the separator before the former last section at its new seam.
    let cut = left.length - 1;
    while (cut > 0 && /[\t \r\n]/.test(left[cut - 1])) cut--;
    const separator = cut + left.slice(cut).search(/[\r\n]/);
    right += left.slice(separator);
    left = left.slice(0, separator);
  }
  const build = (repairSetext: boolean) => {
    const seam = (before: string, next: MarkdownHeading | undefined) => {
      if (!repairSetext || !next?.section?.setext) return "";
      const ending = /(?:\r\n|\r|\n)$/.exec(before);
      return ending && !/[\r\n][\t ]*$/.test(before.slice(0, ending.index))
        ? ending[0]
        : "";
    };
    return (
      prefix +
      seam(prefix, sections[j]) +
      right +
      seam(right, sections[i]) +
      left +
      seam(left, sections[k]) +
      suffix
    );
  };
  // An ATX heading can interrupt a paragraph. A Setext heading may need one
  // more line break at its new seam to keep the preceding text out of its title.
  for (const repair of [false, true]) {
    const content = build(repair);
    if (content === source) return;
    const result = markdownHeadings(content, v2).filter(
      (heading) => heading.section,
    );
    if (
      result.length === expected.length &&
      result.every((heading, i) => {
        const original = expected[i];
        return (
          heading.level === original.level && heading.title === original.title
        );
      })
    )
      return { content, heading: result[destination] };
  }
}
const safetyParser = createMarkdownParser(true, false).set({ html: true });
export function requiresSourceMode(value: string) {
  const env: { references?: Record<string, unknown>; footnotes?: unknown } = {};
  const tokens = safetyParser.parse(value, env);
  if (env.footnotes || (env.references && Object.keys(env.references).length))
    return true;
  const unsafe = (token: (typeof tokens)[number]): boolean =>
    token.type === "mdk_front_matter" ||
    token.type === "html_block" ||
    token.type === "html_inline" ||
    (token.type === "inline" &&
      /(?:^|\n)\s*(?::{3,}|\[\^[^\]]+\]:)/.test(token.content)) ||
    !!token.children?.some(unsafe);
  return tokens.some(unsafe);
}

// Use the Markdown parser's block maps so examples inside code, lists and quotes
// never become chapter boundaries. Slice the original lines to retain CRLF/BOM.
export function splitMarkdownByHeading(source: string): string[] {
  const headings = parser
    .parse(source, {})
    .filter(
      (token) =>
        token.type === "heading_open" && token.level === 0 && token.map,
    );
  const depth = Math.min(
    ...headings.map((token) => Number(token.tag.slice(1))),
  );
  const boundaries = headings
    .filter((token) => Number(token.tag.slice(1)) === depth)
    .slice(1)
    .map((token) => token.map![0]);
  const lines =
    source.match(/[^\r\n]*(?:\r\n|\r|\n|$)/g)?.filter(Boolean) ?? [];
  return [0, ...boundaries].map((start, index) =>
    lines.slice(start, boundaries[index]).join(""),
  );
}
