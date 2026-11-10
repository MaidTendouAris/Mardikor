import { t } from "./i18n";
import MarkdownIt from "markdown-it";
import taskLists from "markdown-it-task-lists";
import footnote from "markdown-it-footnote";
import type { RuleBlock } from "markdown-it/lib/parser_block.mjs";

export const mdkContainerOpening = /^(:{3,})[\t ]*(note|warning|tip)[\t ]*$/;

export function mdkContainerClose(
  length: number,
  lines: Iterable<{ position: number; value: string }>,
) {
  const stack = [length];
  let fence: { marker: string; length: number } | null = null;
  for (const { position, value } of lines) {
    const code = value.match(/^(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (
        code &&
        code[1][0] === fence.marker &&
        code[1].length >= fence.length &&
        !code[2].trim()
      )
        fence = null;
      continue;
    }
    if (code) {
      fence = { marker: code[1][0], length: code[1].length };
      continue;
    }
    const nested = value.match(mdkContainerOpening);
    if (nested && nested[1].length < stack.at(-1)!) {
      stack.push(nested[1].length);
      continue;
    }
    const close = value.match(/^(:{3,})[\t ]*$/);
    if (close && close[1].length >= stack.at(-1)!) {
      stack.pop();
      if (!stack.length) return position;
    }
  }
  return -1;
}

// Unclosed and unknown declarations fall through as ordinary Markdown.
const containerRule: RuleBlock = (state, start, end, silent) => {
  const line = (index: number) =>
    state.src.slice(
      state.bMarks[index] + state.tShift[index],
      state.eMarks[index],
    );
  if (state.sCount[start] - state.blkIndent >= 4) return false;
  const opening = line(start).match(mdkContainerOpening);
  if (!opening) return false;
  function* lines() {
    for (let position = start + 1; position < end; position++) {
      const value = line(position);
      if (state.sCount[position] < state.blkIndent && value.trim()) break;
      if (state.sCount[position] - state.blkIndent < 4)
        yield { position, value };
    }
  }
  const closing = mdkContainerClose(opening[1].length, lines());
  if (closing < 0) return false;
  if (silent) return true;
  const previousParent = state.parentType,
    previousMax = state.lineMax;
  state.parentType = "container" as typeof state.parentType;
  state.lineMax = closing;
  const token = state.push("mdk_container_open", "aside", 1);
  token.block = true;
  token.markup = opening[1];
  token.map = [start, closing];
  token.attrSet("class", "mdk-" + opening[2]);
  state.md.block.tokenize(state, start + 1, closing);
  state.push("mdk_container_close", "aside", -1).block = true;
  state.parentType = previousParent;
  state.lineMax = previousMax;
  state.line = closing + 1;
  return true;
};
const frontMatter: RuleBlock = (state, start, end, silent) => {
  if (start !== 0 || state.parentType !== "root" || state.env.continuedPage)
    return false;
  const line = (index: number) =>
    state.src.slice(state.bMarks[index], state.eMarks[index]).trim();
  if (line(0) !== "---") return false;
  let key = false;
  for (let index = 1; index < end; index++) {
    const value = line(index);
    if (value === "---" || value === "...") {
      if (!key) return false;
      if (!silent) {
        state.push("mdk_front_matter", "", 0).map = [0, index + 1];
        state.line = index + 1;
      }
      return true;
    }
    if (!key && value && !value.startsWith("#")) {
      if (!/^[\p{L}\p{N}_-]+\s*:(?:\s|$)/u.test(value)) return false;
      key = true;
    }
  }
  return false;
};
export function createMarkdownParser(containers = true, taskCheckboxes = true) {
  const parser = new MarkdownIt("commonmark", {
    html: false,
    linkify: false,
    typographer: false,
  }).enable(["table", "strikethrough"]);
  // The plug-in's declarations target MarkdownIt's equivalent CJS interface.
  parser.use(footnote as unknown as (md: MarkdownIt) => void);
  const backlink = parser.renderer.rules.footnote_anchor!;
  parser.renderer.rules.footnote_anchor = (...args) => {
    const label = parser.utils.escapeHtml(
      args[3].footnoteLabel ?? t("返回脚注引用"),
    );
    return backlink(...args).replace(">↩︎</a>", ` aria-label="${label}">^</a>`);
  };
  parser.renderer.rules.mdk_container_open = (
    tokens,
    index,
    options,
    _env,
    renderer,
  ) => {
    const kind = tokens[index].attrGet("class");
    const label =
      kind === "mdk-note" ? "Note" : kind === "mdk-warning" ? "Warning" : "Tip";
    return (
      renderer.renderToken(tokens, index, options) +
      '<strong class="container-label">' +
      label +
      "</strong>\n"
    );
  };
  parser.block.ruler.before("hr", "mdk_front_matter", frontMatter);
  parser.renderer.rules.mdk_front_matter = () => "";
  if (taskCheckboxes) parser.use(taskLists);
  if (containers)
    parser.block.ruler.before("fence", "mdk_container", containerRule, {
      alt: ["paragraph", "reference", "blockquote", "list"],
    });
  return parser;
}
