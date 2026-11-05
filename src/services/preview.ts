import { createMarkdownParser } from "../../shared/markdown-parser";
import { resolveReference } from "../../shared/references";

import type { MdkSettings } from "./mdk";
import Token from "markdown-it/lib/token.mjs";

function createPreviewParser(containers: boolean, standalone = false) {
  const parser = createMarkdownParser(containers);
  if (standalone) {
    const validate = parser.validateLink;
    parser.validateLink = (href) => /^file:\/\//i.test(href) || validate(href);
  }
  parser.renderer.rules.image = (tokens, index) => {
    const token = tokens[index],
      source = token.attrGet("src") ?? "",
      alt = parser.renderer.renderInlineAsText(
        token.children ?? [],
        parser.options,
        {},
      );
    return (
      '<img data-mdk-ref="' +
      parser.utils.escapeHtml(source) +
      '" alt="' +
      parser.utils.escapeHtml(alt) +
      '" />'
    );
  };
  const link =
    parser.renderer.rules.link_open ??
    ((tokens, index, options, _env, renderer) =>
      renderer.renderToken(tokens, index, options));
  parser.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
    const token = tokens[index],
      href = token.attrGet("href") ?? "";
    if (
      standalone ||
      resolveReference(env.sourcePath ?? "markdown/document.md", href).kind !==
        "unsafe"
    )
      token.attrSet("data-mdk-link", href);
    token.attrs = token.attrs?.filter(([key]) => key !== "href") ?? [];
    token.attrSet("href", "#");
    return link(tokens, index, options, env, renderer);
  };
  return parser;
}
const md = createPreviewParser(true),
  plain = createPreviewParser(false),
  standaloneParser = createPreviewParser(false, true);

export function renderPreview(
  markdown: string,
  settings?: MdkSettings,
  position = "",
  mode = "00",
  prefix = "",
  sourcePath = "markdown/document.md",
  standalone = false,
) {
  const parser = standalone
    ? standaloneParser
    : settings?.preview.render_containers === false
      ? plain
      : md;
  const env = { sourcePath };
  const tokens = parser.parse(markdown, env),
    headings: { level: number; title: string; id: string }[] = [];
  const counters = [0, 0, 0, 0, 0, 0];
  let removedTitle = false;
  let headingNumber = 0;
  const fragments = new Set<string>();
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.type !== "heading_open") continue;
    const level = Number(token.tag.slice(1)),
      inline = tokens[index + 1],
      id = `${prefix}mdk-heading-${++headingNumber}`;
    token.attrSet("id", id);
    if (standalone) {
      const base = parser.renderer
        .renderInlineAsText(inline.children ?? [], parser.options, env)
        .trim()
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, "")
        .replace(/\s+/g, "-");
      let fragment = base;
      for (let n = 1; fragments.has(fragment); n++) fragment = `${base}-${n}`;
      fragments.add(fragment);
      token.attrSet("data-fragment", fragment);
    }
    if (
      settings?.preview.show_title === false &&
      level === 1 &&
      !removedTitle
    ) {
      token.hidden = true;
      inline.hidden = true;
      inline.content = "";
      inline.children = [];
      tokens[index + 2].hidden = true;
      removedTitle = true;
      continue;
    }
    if (settings?.mode.book.chapter_numbering && mode === "01") {
      counters[level - 1]++;
      counters.fill(0, level);
      const prefix =
        level === 1 && position
          ? position
          : [position, ...counters.slice(1, level)].filter(Boolean).join(".") ||
            counters.slice(0, level).join(".");
      const text = new Token("text", "", 0);
      text.content = prefix + " ";
      inline.children?.unshift(text);
    }
    headings.push({ level, title: inline.content, id });
  }
  const depth = mode === "01" ? (settings?.mode.book.toc_depth ?? 6) : 6;
  const toc =
    settings?.preview.show_toc && headings.length
      ? `<nav class="preview-toc" aria-label="文稿目录"><strong>目录</strong>${headings
          .filter((h) => h.level <= depth)
          .map(
            (h) =>
              `<a href="#${h.id}" style="padding-left:${(h.level - 1) * 12}px">${parser.utils.escapeHtml(h.title)}</a>`,
          )
          .join("")}</nav>`
      : "";
  return toc + parser.renderer.render(tokens, parser.options, env);
}

export function settingsToCss(settings: MdkSettings) {
  const note = {
    border: "#2563eb",
    background: "#eff6ff",
    text: "#1e3a8a",
  };
  const warning = {
    border: "#d97706",
    background: "#fffbeb",
    text: "#78350f",
  };
  const tip = {
    border: "#4f80d8",
    background: "#eff4fe",
    text: "#31548c",
  };

  return {
    "--preview-font-family":
      settings.appearance.font_family === "system"
        ? '"Segoe UI", "Microsoft YaHei", sans-serif'
        : settings.appearance.font_family,
    "--preview-font-size": `${settings.appearance.font_size}px`,
    "--preview-line-height": String(settings.appearance.line_height),
    "--preview-paragraph-spacing": `${settings.appearance.paragraph_spacing}em`,
    "--preview-text": settings.colors.text,
    "--preview-bg": settings.colors.background,
    "--preview-link": settings.colors.link,
    "--preview-quote": settings.colors.quote,
    "--preview-width": `${settings.layout.page_width}px`,
    "--preview-margin-top": `${settings.layout.margin_top}px`,
    "--preview-margin-bottom": `${settings.layout.margin_bottom}px`,
    "--preview-margin-left": `${settings.layout.margin_left}px`,
    "--preview-margin-right": `${settings.layout.margin_right}px`,
    "--note-border": note.border,
    "--note-bg": note.background,
    "--note-text": note.text,
    "--warning-border": warning.border,
    "--warning-bg": warning.background,
    "--warning-text": warning.text,
    "--tip-border": tip.border,
    "--tip-bg": tip.background,
    "--tip-text": tip.text,
  } as Record<string, string>;
}
