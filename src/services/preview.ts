import { t } from "../../shared/i18n";
import { createMarkdownParser } from "../../shared/markdown-parser";
import { resolveReference } from "../../shared/references";
import { chapterHeadingNumberer } from "../../shared/heading-numbering";

import type { MdkSettings } from "./mdk";
import Token from "markdown-it/lib/token.mjs";
import type mathPlugin from "@vscode/markdown-it-katex";
import type { DocumentPages } from "./document-pages";

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
  standaloneParser = createPreviewParser(true, true),
  standalonePlain = createPreviewParser(false, true);

export function mayContainMath(markdown: string) {
  return /\$[^\s$]|\$\$/.test(markdown);
}

let mathEnabled = false;
export function enablePreviewMath(
  module: typeof mathPlugin | { default: typeof mathPlugin },
) {
  if (mathEnabled) return;
  const plugin = typeof module === "function" ? module : module.default;
  const options = {
    output: "mathml",
    trust: false,
    strict: "ignore",
    maxExpand: 100,
    maxSize: 20,
    throwOnError: false,
  } as const;
  for (const parser of [md, plain, standaloneParser, standalonePlain]) {
    parser.use(plugin, options);
    for (const rule of ["math_inline", "math_inline_block", "math_block"]) {
      const render = parser.renderer.rules[rule]!;
      parser.renderer.rules[rule] = (tokens, index, opts, env, renderer) => {
        env.mathCount = (env.mathCount ?? 0) + 1;
        const token = tokens[index];
        if (env.mathCount <= 500 && token.content.length <= 4000)
          return render(tokens, index, opts, env, renderer);
        return `<code>${parser.utils.escapeHtml(token.content)}</code>`;
      };
    }
  }
  mathEnabled = true;
}

export type PreviewContext = {
  headingOffset: number;
  priorHeadingLevels: number[];
  continuedPage?: boolean;
  pageNumber?: number;
  references?: DocumentPages["references"];
  notes?: string;
  literal?: boolean;
};

export function renderPreview(
  markdown: string,
  settings?: MdkSettings,
  position = "",
  mode = "00",
  prefix = "",
  sourcePath = "markdown/document.md",
  standalone = false,
  reservedSections?: ReadonlySet<string>,
  page?: PreviewContext,
) {
  const parser = standalone
    ? settings?.preview.render_containers === false
      ? standalonePlain
      : standaloneParser
    : settings?.preview.render_containers === false
      ? plain
      : md;
  if (page?.literal)
    return (
      '<pre class="preview-literal">' +
      parser.utils.escapeHtml(markdown) +
      "</pre>"
    );
  const env = {
    footnoteLabel: t("返回脚注引用"),
    sourcePath,
    docId:
      (prefix || "preview") +
      (page?.pageNumber === undefined ? "" : "page-" + page.pageNumber),
    references: page?.references && { ...page.references },
    continuedPage: page?.continuedPage,
  };
  const tokens = parser.parse(
      markdown +
        (page?.notes && markdown.includes("[^") ? "\n\n" + page.notes : ""),
      env,
    ),
    headings: { level: number; title: string; id: string }[] = [];
  const numberHeading = chapterHeadingNumberer(position, reservedSections);
  for (const level of page?.priorHeadingLevels ?? []) numberHeading(level);
  let removedTitle = page?.priorHeadingLevels.includes(1) ?? false;
  let headingNumber = page?.headingOffset ?? 0;
  const fragments = new Set<string>(),
    counts = new Map<string, number>();
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
      let n = counts.get(base) ?? 0;
      let fragment = n ? `${base}-${n}` : base;
      while (fragments.has(fragment)) fragment = `${base}-${++n}`;
      counts.set(base, n + 1);
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
      numberHeading(level);
      continue;
    }
    let title = parser.renderer.renderInlineAsText(
      inline.children ?? [],
      parser.options,
      env,
    );
    if (settings?.mode.book.chapter_numbering && mode === "01") {
      const prefix = numberHeading(level);
      const text = new Token("text", "", 0);
      text.content = prefix ? prefix + " " : "";
      inline.children?.unshift(text);
      title = text.content + title;
    }
    headings.push({ level, title, id });
  }
  const depth = mode === "01" ? (settings?.mode.book.toc_depth ?? 6) : 6;
  const toc =
    settings?.preview.show_toc &&
    headings.length &&
    (!page || headings.length <= 1000)
      ? t(
          '<nav class="preview-toc" aria-label="文稿目录"><strong>目录</strong>{0}</nav>',
          headings
            .filter((h) => h.level <= depth)
            .map(
              (h) =>
                `<a href="#${h.id}" style="padding-left:${(h.level - 1) * 12}px">${parser.utils.escapeHtml(h.title)}</a>`,
            )
            .join(""),
        )
      : "";
  if (tokens.length < 800 || page)
    return toc + parser.renderer.render(tokens, parser.options, env);
  // Split only between top-level blocks, after parsing the whole document.
  // References, lists, footnotes and heading anchors keep their original scope.
  const sections: string[] = [];
  let start = 0;
  for (let end = 0; end <= tokens.length; end++) {
    if (
      end === tokens.length ||
      (end - start >= 160 &&
        tokens[end].level === 0 &&
        tokens[end].nesting !== -1)
    ) {
      const part = tokens.slice(start, end);
      const html = parser.renderer.render(part, parser.options, env);
      sections.push('<div class="preview-section">' + html + "</div>");
      start = end;
    }
  }
  return toc + sections.join("");
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
