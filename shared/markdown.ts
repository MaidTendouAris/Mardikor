import { createMarkdownParser } from "./markdown-parser";

const parser = createMarkdownParser();
export interface MarkdownHeading {
  index: number;
  level: number;
  depth: number;
  title: string;
  line: number;
}
export function markdownHeadings(source: string): MarkdownHeading[] {
  const tokens = parser.parse(source, {}),
    headings: MarkdownHeading[] = [],
    stack: number[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type !== "heading_open" || !token.map) continue;
    const level = Number(token.tag.slice(1));
    while (stack.length && stack.at(-1)! >= level) stack.pop();
    headings.push({
      index: headings.length,
      level,
      depth: stack.length,
      title: parser.renderer.renderInlineAsText(
        tokens[i + 1]?.children ?? [],
        parser.options,
        {},
      ),
      line: token.map[0] + 1,
    });
    stack.push(level);
  }
  return headings;
}
const safetyParser = createMarkdownParser(true, false).set({ html: true });
export function requiresSourceMode(value: string) {
  const env: { references?: Record<string, unknown>; footnotes?: unknown } = {};
  const tokens = safetyParser.parse(value, env);
  if (env.footnotes || (env.references && Object.keys(env.references).length))
    return true;
  const unsafe = (token: (typeof tokens)[number]): boolean =>
    token.type === "mdk_container_open" ||
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
