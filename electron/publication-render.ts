import {
  emojiFontFile,
  escapeXml,
  type PreparedPublication,
} from "./publication";
import { publicationLabels } from "../shared/publication";

export function publicationFontFamily(prepared: PreparedPublication) {
  return prepared.emojiFont
    ? "PublicationEmoji,PublicationFont"
    : "PublicationFont";
}

export function publicationCss(prepared: PreparedPublication, fixed: boolean) {
  const { configuration: c, height, fontFile } = prepared,
    {
      appearance: a,
      layout: l,
      colors,
      publication: { pdf },
    } = c;
  const scale = prepared.format === "pdf" ? pdf.scale : 1;
  const fontFamily = publicationFontFamily(prepared);
  const emojiRanges = [...(prepared.emojiFont?.text ?? "")]
    .map((character) => "U+" + character.codePointAt(0)!.toString(16))
    .join(",");
  const gray = (color: string) => {
    if (!pdf.grayscale || prepared.format !== "pdf") return color;
    const hex = color.slice(1),
      expanded = hex.length <= 4 ? [...hex].map((c) => c + c).join("") : hex;
    const channel = Math.round(
      0.2126 * parseInt(expanded.slice(0, 2), 16) +
        0.7152 * parseInt(expanded.slice(2, 4), 16) +
        0.0722 * parseInt(expanded.slice(4, 6), 16),
    )
      .toString(16)
      .padStart(2, "0");
    return "#" + channel.repeat(3) + expanded.slice(6);
  };
  return `
@font-face{font-family:PublicationFont;src:url("${fontFile}");font-style:normal;font-weight:100 900;font-display:block}
${emojiRanges ? `@font-face{font-family:PublicationEmoji;src:url("assets/${emojiFontFile}");font-weight:300 700;unicode-range:${emojiRanges}}` : ""}
*{box-sizing:border-box}html{font-family:${fontFamily};font-size:${a.font_size}px;line-height:${a.line_height};font-synthesis:weight style;overflow-wrap:anywhere;color:${gray(colors.text)};background:${prepared.format === "pdf" && !pdf.print_background ? "#fff" : gray(colors.background)}}
body{margin:0}h1,h2,h3,h4,h5,h6{line-height:1.35;margin:1.3em 0 .6em;break-after:avoid}h1:first-child,h2:first-child{margin-top:0}h1{font-size:2em}h2{font-size:1.5em}h3{font-size:1.25em}h4,h5,h6{font-size:1em}
p{margin:0 0 ${a.paragraph_spacing}em}a{color:${gray(colors.link)};text-decoration:underline}img{max-width:100%;height:auto;object-fit:${c.comic.page_fit === "cover" ? "cover" : "contain"};${pdf.grayscale && prepared.format === "pdf" ? "filter:grayscale(1)" : ""}}
pre,code,kbd,samp{font-family:${fontFamily};font-size:.9em}pre{white-space:pre-wrap;overflow-wrap:anywhere;padding:.75em;background:#f3f5f8;border:1px solid #ddd;break-inside:auto}code{white-space:pre-wrap}blockquote{margin:1em 0;padding-left:1em;border-left:3px solid #bbc7db;color:${gray(colors.quote)}}
table{border-collapse:collapse;table-layout:fixed;width:100%;margin:1em 0}th,td{border:1px solid #bbc2cb;padding:.45em;overflow-wrap:anywhere}thead{display:table-header-group}tr{break-inside:avoid}hr{border:0;border-top:1px solid #bbb;margin:1.5em 0}ul,ol{padding-left:1.8em}li>p{margin-bottom:.3em}li{orphans:2;widows:2}p{orphans:2;widows:2}.task-list-item{list-style:none}.task-marker{margin-right:.4em}aside{border-left:3px solid #6a8ec9;padding:.75em;margin:1em 0;background:#f2f6fc}
.toc a{color:inherit}.toc ol{list-style:none;padding-left:1.2em}.toc>ol{padding-left:0}.toc li{margin:.3em 0}.cover{display:flex;align-items:center;justify-content:center}.cover img{max-height:100%;width:100%;height:100%;object-fit:contain}
th{text-align:left}
.katex-block{break-inside:avoid;text-align:center}math{max-width:100%}
.katex span[class*="_fallback"]{font-family:${fontFamily}}
${fixed ? `.unit{height:${(height - l.margin_top - l.margin_bottom) / scale}px;min-width:0}.unit>p:only-child:has(>img:only-child){height:100%;margin:0;line-height:0}.unit>p:only-child>img:only-child{height:${c.comic.page_fit === "width" ? "auto" : "100%"};max-height:${c.comic.page_fit === "width" ? "none" : "100%"};width:100%;object-fit:${c.comic.page_fit === "width" ? "contain" : c.comic.page_fit}}` : ""}
@media print{a{text-decoration:inherit}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
`;
}
export function publicationHtml(prepared: PreparedPublication) {
  const { configuration: c, snapshot, width, height } = prepared,
    {
      layout: l,
      publication: { pdf, epub, metadata },
    } = c;
  const fixed =
    prepared.format === "pdf"
      ? snapshot.project.mode === "02"
      : epub.layout === "pre-paginated";
  const scale = prepared.format === "pdf" ? pdf.scale : 1;
  const pair =
    prepared.format === "pdf" &&
    snapshot.project.mode === "02" &&
    c.comic.spread_mode === "double";
  const rewrite = (html: string, index: number) =>
    html
      .replace(/\bid="([^"]+)"/g, (_match, id) => `id="u${index}-${id}"`)
      .replace(
        /href="#(fn(?:ref)?[^"]+)"/g,
        (_match, id) => `href="#u${index}-${id}"`,
      )
      .replace(
        /href="(chapter-\d+\.xhtml)(#[^"]*)?"/g,
        (_match, name: string, suffix?: string) => {
          const target = prepared.chapters.findIndex(
            (chapter) => chapter.file === name,
          );
          return `href="#u${target}-${suffix ? suffix.slice(1) : "start"}"`;
        },
      );
  const chapters = prepared.chapters.map(
    (chapter, index) =>
      `<section class="unit" data-unit="${index + 1}" id="u${index}-start">${rewrite(chapter.html, index)}</section>`,
  );
  let content = "";
  if (prepared.coverFile)
    content += `<section class="cover front-page unit" data-unit="封面"><img src="${prepared.coverFile}" alt="${escapeXml(metadata.title)}" /></section>`;
  if (prepared.format === "pdf" ? pdf.include_toc : epub.toc_in_spine)
    content += `<nav class="toc front-page ${fixed ? "unit" : ""}" data-unit="目录"><h1>${publicationLabels(metadata.language).toc}</h1>${rewrite(
      prepared.navigation,
      0,
    ).replace(
      /<a href="#([^"]+)">([\s\S]*?)<\/a>/g,
      (link, destination, title) =>
        prepared.format === "pdf"
          ? `<a class="toc-entry" href="#${destination}"><span>${title}</span><span class="toc-page" data-destination="${destination}"></span></a>`
          : link,
    )}</nav>`;
  if (pair) {
    for (let index = 0; index < chapters.length; index += 2)
      content += `<div class="spread" dir="${c.comic.reading_direction}">${chapters.slice(index, index + 2).join("")}</div>`;
  } else content += chapters.join("");
  const breaks = fixed ? "page" : pdf.chapter_break;
  const marginContent = (template: string) =>
    template
      .split(/(\{(?:title|author|page|pages)\})/g)
      .map((part) => {
        if (part === "{page}") return "counter(page)";
        if (part === "{pages}") return "counter(pages)";
        const value =
          part === "{title}"
            ? metadata.title
            : part === "{author}"
              ? metadata.author
              : part;
        return (
          '"' +
          value
            .replace(/\\/g, "\\\\")
            .replace(/"/g, '\\"')
            .replace(/</g, "\\3C ")
            .replace(/>/g, "\\3E ")
            .replace(/\r?\n/g, " ") +
          '"'
        );
      })
      .join(" ");
  const furniture = `font-family:${publicationFontFamily(prepared)};font-size:${pdf.furniture_size}px;font-weight:normal;line-height:1.2;color:#555;white-space:pre;vertical-align:middle;`;
  const marginBoxes =
    prepared.format === "pdf"
      ? `@top-center{content:${marginContent(pdf.header)};${furniture}}@bottom-center{content:${marginContent(pdf.footer || (pdf.page_numbers ? "{page} / {pages}" : ""))};${furniture}}`
      : "";
  const css =
    publicationCss(prepared, fixed) +
    `
@page{size:${width}px ${height}px;margin:${l.margin_top}px ${l.margin_right}px ${l.margin_bottom}px ${l.margin_left}px;${marginBoxes}}
.toc-entry{display:grid;grid-template-columns:minmax(0,1fr) 7ch;gap:.45em}.toc-page{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
${prepared.format === "pdf" && pdf.first_page_number !== 1 ? `@page:first{counter-increment:page ${pdf.first_page_number}}` : ""}
body{width:${(width - l.margin_left - l.margin_right) / scale}px}.front-page{break-after:page;min-height:${(height - l.margin_top - l.margin_bottom) / scale}px}.cover{height:${(height - l.margin_top - l.margin_bottom) / scale}px}
${pair ? ".spread{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:0;break-after:page}.spread>.unit{direction:ltr}" : `.unit+.unit{break-before:${breaks === "none" ? "auto" : breaks}}`}
`;
  const mathStyles =
    prepared.format === "pdf" &&
    prepared.chapters.some(({ hasMath }) => hasMath)
      ? '<link rel="stylesheet" href="math/katex.min.css">'
      : "";
  return `<!DOCTYPE html><html lang="${escapeXml(metadata.language)}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none';style-src 'self' 'unsafe-inline';img-src 'self';font-src 'self';base-uri 'none';form-action 'none'"><title>${escapeXml(metadata.title)}</title><style>${css}</style>${mathStyles}</head><body>${content}</body></html>`;
}
