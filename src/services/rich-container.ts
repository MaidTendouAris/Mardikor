import { Node, type JSONContent } from "@tiptap/core";
import {
  mdkContainerClose,
  mdkContainerOpening,
} from "../../shared/markdown-parser";

function lineEnd(source: string, start: number) {
  const end = source.indexOf("\n", start);
  return end < 0 ? source.length : end;
}
function containerLine(value: string) {
  return value.replace(/^ {0,3}/, "").replace(/\r$/, "");
}
function* lines(source: string, start: number) {
  for (let position = start; position < source.length;) {
    const end = lineEnd(source, position);
    const value = source.slice(position, end);
    if (!/^(?: {4}|\t)/.test(value))
      yield { position, value: containerLine(value) };
    position = end + 1;
  }
}

function containerDepth(node: JSONContent): number {
  const marker =
    node.type === "mdkContainer"
      ? (String(node.attrs?.opening ?? "")
          .trimStart()
          .match(/^:+/)?.[0].length ?? 3)
      : 0;
  return (node.content ?? []).reduce(
    (depth, child) => Math.max(depth, containerDepth(child)),
    marker,
  );
}

export const MdkContainer = Node.create({
  name: "mdkContainer",
  group: "block",
  content: "block+",
  defining: true,
  isolating: true,
  addAttributes() {
    return {
      kind: { default: "note", rendered: false },
      opening: { default: ":::note", rendered: false },
      closing: { default: ":::", rendered: false },
    };
  },
  parseHTML() {
    return ["note", "warning", "tip"].map((kind) => ({
      tag: 'aside[data-mdk-container="' + kind + '"]',
      attrs: { kind, opening: ":::" + kind },
      contentElement: "[data-mdk-container-body]",
    }));
  },
  renderHTML({ node }) {
    const kind = node.attrs.kind;
    const label =
      kind === "warning" ? "Warning" : kind === "tip" ? "Tip" : "Note";
    return [
      "aside",
      { class: "mdk-" + kind, "data-mdk-container": kind },
      ["strong", { class: "container-label", contenteditable: "false" }, label],
      ["div", { "data-mdk-container-body": "" }, 0],
    ];
  },
  markdownTokenName: "mdkContainer",
  markdownTokenizer: {
    name: "mdkContainer",
    level: "block",
    start(source) {
      const marker =
        /\n {0,3}:{3,}[\t ]*(?:note|warning|tip)[\t ]*(?:\r?\n|$)/.exec(source);
      return marker ? marker.index + 1 : -1;
    },
    tokenize(source, _tokens, lexer) {
      const head = lineEnd(source, 0);
      const opening = source.slice(0, head).replace(/\r$/, "");
      const match = containerLine(opening).match(mdkContainerOpening);
      if (!match || /^(?: {4}|\t)/.test(opening)) return;
      const close = mdkContainerClose(match[1].length, lines(source, head + 1));
      if (close < 0) return;
      const end = lineEnd(source, close);
      const closing = source.slice(close, end).replace(/\r$/, "");
      return {
        type: "mdkContainer",
        raw: source.slice(0, Math.min(source.length, end + 1)),
        kind: match[2],
        opening,
        closing,
        tokens: lexer.blockTokens(source.slice(head + 1, close).trimEnd()),
      };
    },
  },
  parseMarkdown(token, helpers) {
    const children =
      helpers.parseBlockChildren?.(token.tokens ?? []) ??
      helpers.parseChildren(token.tokens ?? []);
    return {
      type: "mdkContainer",
      attrs: {
        kind: token.kind,
        opening: token.opening,
        closing: token.closing,
      },
      content: children.length ? children : [{ type: "paragraph" }],
    };
  },
  renderMarkdown(node, helpers) {
    const opening = String(node.attrs?.opening ?? ":::note");
    const closing = String(node.attrs?.closing ?? ":::");
    const length = opening.trimStart().match(/^:+/)?.[0].length ?? 3;
    const inner = (node.content ?? []).reduce(
      (depth, child) => Math.max(depth, containerDepth(child)),
      0,
    );
    const fence = ":".repeat(Math.max(length, inner + 1));
    const body = helpers.renderChildren(node.content ?? [], "\n\n");
    return (
      opening.replace(/^(\s*):+/, "$1" + fence) +
      "\n" +
      (body ? body + "\n" : "") +
      (closing.trim().length >= fence.length ? closing : fence)
    );
  },
});
