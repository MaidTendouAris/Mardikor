import MarkdownIt from "markdown-it";

const markdown = new MarkdownIt({ linkify: true });
const formatting = new Set(
  "a b blockquote br code dd del details div dl dt em h1 h2 h3 h4 h5 h6 hr i kbd li ol p pre s span strong summary table tbody td th thead tr ul".split(" "),
);
const ignored = new Set(["img", "script", "style", "iframe", "object", "embed"]);

export function renderReleaseNotes(notes: string, releaseUrl: string) {
  const template = document.createElement("template");
  // The GitHub updater can return HTML from the Atom feed or Markdown from latest.yml.
  template.innerHTML = /^\s*<[a-z][\w-]*(?:\s|\/?>)/i.test(notes)
    ? notes
    : markdown.render(notes);
  const result = document.createElement("div");
  function append(parent: HTMLElement, source: Node) {
    if (source.nodeType === Node.TEXT_NODE) {
      parent.append(source.textContent ?? "");
      return;
    }
    if (!(source instanceof Element)) return;
    const tag = source.localName;
    if (ignored.has(tag)) return;
    let destination = parent;
    if (formatting.has(tag)) {
      destination = document.createElement(tag);
      if (tag === "a") {
        const href = source.getAttribute("href");
        try {
          const url = href && new URL(href, releaseUrl);
          if (url && ["http:", "https:", "mailto:"].includes(url.protocol))
            destination.setAttribute("href", url.href);
        } catch {
          // Keep the link text when the target is malformed.
        }
      }
      parent.append(destination);
    }
    for (const child of source.childNodes) append(destination, child);
  }
  for (const child of template.content.childNodes) append(result, child);
  return result.innerHTML;
}
