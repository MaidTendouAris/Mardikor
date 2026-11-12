import { unescapeAll } from "markdown-it/lib/common/utils.mjs";
import {
  lineStarts,
  lowerBound,
  type FindMatches,
  type SearchHit,
} from "./document-find";
import { renderPreview } from "./preview";

export interface FindLocation {
  start: number;
  end: number;
  exact: boolean;
}

export function projectFindHit(
  hit: SearchHit,
  displayed: string,
): FindLocation {
  return projectOffsets(hit.content, displayed)(hit.start, hit.end);
}

function projectOffsets(content: string, displayed: string) {
  if (content === displayed)
    return (start: number, end: number) => ({ start, end, exact: true });
  let prefix = 0;
  const limit = Math.min(content.length, displayed.length);
  while (prefix < limit && content[prefix] === displayed[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < limit - prefix &&
    content[content.length - suffix - 1] ===
      displayed[displayed.length - suffix - 1]
  )
    suffix++;
  const delta = displayed.length - content.length;
  const contextOffsets = new Map<string, number>();
  return (start: number, end: number): FindLocation => {
    if (end <= prefix) return { start, end, exact: true };
    if (start >= content.length - suffix)
      return { start: start + delta, end: end + delta, exact: true };

    // A saved preview may still contain this occurrence elsewhere in the changed
    // section. Require surrounding context before marking text in that snapshot.
    const needle = content.slice(
      Math.max(0, start - 24),
      Math.min(content.length, end + 24),
    );
    let found = contextOffsets.get(needle);
    if (found === undefined) {
      found = displayed.indexOf(needle);
      if (found >= 0 && displayed.indexOf(needle, found + 1) !== -1) found = -1;
      contextOffsets.set(needle, found);
    }
    if (found >= 0) {
      const position = found + Math.min(24, start);
      return { start: position, end: position + end - start, exact: true };
    }
    const anchor = Math.min(start, Math.max(0, displayed.length - suffix));
    return { start: anchor, end: anchor, exact: false };
  };
}

export function findLocations(
  matches: FindMatches | undefined,
  displayed: string,
  from = 0,
  to = displayed.length + 1,
  shift = 0,
): FindLocation[] {
  if (!matches) return [];
  const {
    document: { content },
    offsets,
    length,
  } = matches;
  if (content === displayed) {
    const first = lowerBound(offsets.length, (i) => offsets[i] + length > from);
    const end = lowerBound(offsets.length, (i) => offsets[i] >= to);
    return offsets.slice(first, end).map((start) => ({
      start: Math.max(start, from) + shift,
      end: Math.min(start + length, to) + shift,
      exact: true,
    }));
  }
  const project = projectOffsets(content, displayed);
  return offsets.flatMap((start) => {
    const location = project(start, start + length);
    if (
      location.exact
        ? location.end <= from || location.start >= to
        : location.start < from || location.start >= to
    )
      return [];
    return [
      {
        start: Math.max(location.start, from) + shift,
        end: Math.min(location.end, to) + shift,
        exact: location.exact,
      },
    ];
  });
}

interface SourceBlock {
  node: HTMLElement;
  start: number;
  end: number;
}
function blockIndex(root: HTMLElement, source: string) {
  const lines = lineStarts(source);
  const blocks: SourceBlock[] = [];
  const byLine: (SourceBlock | undefined)[] = [];
  for (const node of root.querySelectorAll<HTMLElement>(
    "[data-source-lines]",
  )) {
    const [first, last] = node.dataset.sourceLines!.split(":").map(Number);
    const start = lines[first];
    if (start === undefined) continue;
    const end = lines[last] ?? source.length;
    const block = { node, start, end };
    blocks.push(block);
    for (
      let line = first;
      line < (last < 0 ? lines.length : Math.min(last, lines.length));
      line++
    ) {
      const current = byLine[line];
      if (!current || end - start <= current.end - current.start)
        byLine[line] = block;
    }
  }
  blocks.sort((a, b) => a.start - b.start);
  return (offset: number) => {
    const line = lowerBound(lines.length, (i) => lines[i] > offset) - 1;
    const containing = byLine[line];
    if (containing) return containing;
    const after = lowerBound(blocks.length, (i) => blocks[i].start > offset);
    const previous = blocks[after - 1],
      next = blocks[after];
    return previous && (!next || offset - previous.end < next.start - offset)
      ? previous
      : next;
  };
}

type LinkSpan = {
  start: number;
  labelEnd: number;
  end: number;
  image: boolean;
};
function linksIn(source: string): LinkSpan[] {
  const result: LinkSpan[] = [];
  const brackets: number[] = [];
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === "\\") {
      i++;
    } else if (char === "`") {
      const fence = /^`+/.exec(source.slice(i))![0];
      const closing = source.indexOf(fence, i + fence.length);
      i = closing < 0 ? i + fence.length - 1 : closing + fence.length - 1;
    } else if (char === "[") brackets.push(i);
    else if (char === "]" && brackets.length) {
      const open = brackets.pop()!;
      const next = source[i + 1];
      if (next !== "(" && next !== "[") continue;
      const close = next === "(" ? ")" : "]";
      let depth = 1;
      let end = i + 2;
      for (; end < source.length && depth; end++) {
        if (source[end] === "\\") end++;
        else if (source[end] === close) depth--;
        else if (source[end] === next) depth++;
      }
      if (depth) continue;
      const image = source[open - 1] === "!";
      result.push({ start: image ? open - 1 : open, labelEnd: i, end, image });
      i = end - 1;
    }
  }
  return result;
}

const auxiliary =
  ".container-label,.footnote-backref,.footnote-ref,.rich-page-boundary,[data-find-generated],[aria-hidden=true],annotation";
function textNodes(root: HTMLElement) {
  const document = root.ownerDocument;
  const walker = document.createTreeWalker(
    root,
    document.defaultView!.NodeFilter.SHOW_TEXT,
  );
  const nodes: Text[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (node.data && !node.parentElement?.closest(auxiliary)) nodes.push(node);
  }
  return nodes;
}

function rangeMapper(node: HTMLElement, source: string) {
  const document = node.ownerDocument;
  const code = node.matches("code,pre");
  const links = code ? [] : linksIn(source).sort((a, b) => a.start - b.start);
  const nodes = textNodes(node);
  const masks = links
    .map((link) => ({
      start: link.image ? link.start : link.labelEnd,
      end: link.end,
    }))
    .sort((a, b) => a.start - b.start);
  const starts = new Uint32Array(source.length);
  const ends = new Uint32Array(source.length);
  let normalized = "";
  const append = (text: string, start: number, end: number) => {
    const offset = normalized.length;
    normalized += text;
    starts.fill(start, offset, normalized.length);
    ends.fill(end, offset, normalized.length);
  };
  let linkIndex = 0;
  const fence = code
    ? /^\s*(?:`{3,}|~{3,})[^\r\n]*(?:\r\n|\r|\n)/.exec(source)
    : null;
  for (let i = fence?.[0].length ?? 0; i < source.length;) {
    const mask = masks[linkIndex];
    if (mask && i >= mask.start) {
      i = Math.max(i, mask.end);
      linkIndex++;
      continue;
    }
    if (!code && (source[i] === "&" || source[i] === "\\")) {
      const escape =
        /^(?:&(?:#[xX][0-9a-f]+|#\d+|[a-z][a-z0-9]*);|\\[^\p{L}\p{N}\s])/iu.exec(
          source.slice(i),
        );
      if (escape) {
        append(unescapeAll(escape[0]), i, i + escape[0].length);
        i += escape[0].length;
        continue;
      }
    }
    append(source[i], i, i + 1);
    i++;
  }
  const runs: { text: Text; offset: number; start: number; end: number }[] = [];
  let cursor = 0;
  for (const text of nodes) {
    const value = text.data;
    const start = normalized.indexOf(value, cursor);
    if (start >= 0) {
      cursor = start + value.length;
      runs.push({ text, offset: 0, start, end: cursor });
      continue;
    }
    // A text node can combine visible characters separated by Markdown syntax.
    for (let i = 0; i < value.length; i++) {
      const index = normalized.indexOf(value[i], cursor);
      if (index < 0) continue;
      const previous = runs.at(-1);
      if (
        previous?.text === text &&
        previous.end === index &&
        previous.offset + previous.end - previous.start === i
      )
        previous.end++;
      else runs.push({ text, offset: i, start: index, end: index + 1 });
      cursor = index + 1;
    }
  }
  return ({ start, end, exact }: FindLocation): Range[] => {
    if (!exact) return [];
    // Link targets and image descriptions map to the rendered link or image.
    const syntax = links.find(
      (link) =>
        link.start <= start &&
        end <= link.end &&
        (link.image || start >= link.labelEnd),
    );
    if (syntax) {
      const sameKind = links.filter(({ image }) => image === syntax.image);
      const media = node.querySelectorAll(
        syntax.image ? "img" : "a:not(.footnote-backref)",
      );
      if (media.length === sameKind.length) {
        const range = document.createRange();
        range.selectNode(media[sameKind.indexOf(syntax)]);
        return [range];
      }
    }
    const first = lowerBound(normalized.length, (i) => ends[i] > start);
    const last = lowerBound(normalized.length, (i) => starts[i] >= end);
    const ranges: Range[] = [];
    for (
      let i = lowerBound(runs.length, (i) => runs[i].end > first);
      i < runs.length && runs[i].start < last;
      i++
    ) {
      const { text, offset, start, end } = runs[i];
      const from = Math.max(first, start);
      const to = Math.min(last, end);
      if (from >= to) continue;
      const range = document.createRange();
      range.setStart(text, offset + from - start);
      range.setEnd(text, offset + to - start);
      ranges.push(range);
    }
    return ranges;
  };
}

const richMaps = new WeakMap<
  HTMLElement,
  { source: string; html: HTMLElement }
>();
export function createFindMapper(
  root: HTMLElement,
  source: string,
  rich = false,
) {
  let map = root;
  if (rich) {
    let cached = richMaps.get(root);
    if (cached?.source !== source) {
      const document = root.ownerDocument;
      const template = document.createElement("template");
      template.innerHTML = renderPreview(
        source,
        undefined,
        "",
        "00",
        "",
        undefined,
        false,
        undefined,
        undefined,
        false,
        true,
      );
      const html = document.createElement("div");
      html.append(template.content);
      cached = { source, html };
      richMaps.set(root, cached);
    }
    map = cached.html;
  }
  const findBlock = blockIndex(map, source);
  const mappers = new Map<
    SourceBlock,
    {
      node: HTMLElement;
      ranges: ReturnType<typeof rangeMapper>;
    }
  >();
  const tags = new Map<string, Map<HTMLElement, HTMLElement>>();
  return (location: FindLocation) => {
    const block = findBlock(location.start);
    if (!block) return { node: root, ranges: [] };
    let mapper = mappers.get(block);
    if (!mapper) {
      let node = block.node;
      if (rich) {
        const selector = node.tagName.toLowerCase();
        let peers = tags.get(selector);
        if (!peers) {
          const actual = root.querySelectorAll<HTMLElement>(selector);
          peers = new Map(
            Array.from(
              map.querySelectorAll<HTMLElement>(selector),
              (item, index) => [item, actual[index]],
            ),
          );
          tags.set(selector, peers);
        }
        node = peers.get(node) ?? root;
      }
      mapper = {
        node,
        ranges: rangeMapper(node, source.slice(block.start, block.end)),
      };
      mappers.set(block, mapper);
    }
    return {
      node: mapper.node,
      ranges: mapper.ranges({
        start: location.start - block.start,
        end: location.end - block.start,
        exact:
          location.exact &&
          location.start >= block.start &&
          location.start < block.end,
      }),
    };
  };
}

export function mapFindLocation(
  root: HTMLElement,
  source: string,
  location: FindLocation,
  rich = false,
) {
  return createFindMapper(root, source, rich)(location);
}
