import path from "node:path";
import type MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import { t } from "../shared/i18n";
import { resolveReference } from "../shared/references";

type References = Record<string, { href: string; title: string }>;

export function rewriteResourceLinks(
  parser: MarkdownIt,
  file: string,
  source: string,
  rename: (path: string) => string | undefined,
) {
  const rewritten = (url: string) => {
    const target = resolveReference(file, url);
    if (target.kind !== "local") return url;
    const next = rename(target.path);
    if (!next) return url;
    return (
      path.posix
        .relative(path.posix.dirname(file), next)
        .split("/")
        .map(encodeURIComponent)
        .join("/") + target.suffix
    );
  };
  let needsChange = false;
  const ignored: [number, number][] = [];
  const lines = [0];
  for (const eol of source.matchAll(/\r\n|\r|\n/g))
    lines.push(eol.index + eol[0].length);
  // MarkdownIt resolves inline and reference-style destinations, but doesn't
  // expose source offsets. Verify every candidate against its parsed tokens.
  function parsed(markdown: string, remap = false) {
    const env: { references?: References } = {};
    const simplify = (token: Token): unknown => [
      token.type,
      token.tag,
      token.markup,
      token.nesting,
      token.hidden,
      token.type === "inline" ? "" : token.content,
      token.info,
      token.meta,
      token.attrs?.map(([key, value]) => {
        if (
          !remap ||
          !(
            (key === "href" && token.type === "link_open") ||
            (key === "src" && token.type === "image")
          )
        )
          return [key, value];
        const next = rewritten(value);
        needsChange ||= value !== next;
        return [key, next];
      }),
      token.children?.map(simplify),
    ];
    const tokens = parser.parse(markdown, env).map((token) => {
      if (
        remap &&
        token.map &&
        (token.type === "fence" || token.type === "code_block")
      )
        ignored.push([
          lines[token.map[0]],
          lines[token.map[1]] ?? source.length,
        ]);
      return simplify(token);
    });
    const references = Object.entries(env.references ?? {}).map(
      ([label, ref]) => {
        const href = remap ? rewritten(ref.href) : ref.href;
        needsChange ||= href !== ref.href;
        return [label, href, ref.title];
      },
    );
    return JSON.stringify([tokens, references]);
  }
  const expected = parsed(source, true);
  if (!needsChange) return source;
  let next = source;
  const edits: { start: number; end: number; text: string }[] = [];
  for (const match of source.matchAll(/\](?:\(|:)[ \t\r\n]*/g)) {
    const start = match.index + match[0].length;
    if (ignored.some(([from, to]) => from <= start && start < to)) continue;
    const destination = parser.helpers.parseLinkDestination(
      source,
      start,
      source.length,
    );
    if (!destination.ok) continue;
    const url = parser.normalizeLink(destination.str);
    const replacement = rewritten(url);
    if (replacement !== url)
      edits.push({
        start,
        end: destination.pos,
        text: "<" + replacement + ">",
      });
  }
  for (const edit of edits.reverse())
    next = next.slice(0, edit.start) + edit.text + next.slice(edit.end);
  if (parsed(next) !== expected)
    throw new Error(t("无法安全更新 {0} 中的资源引用，已保留原路径。", file));
  return next;
}
