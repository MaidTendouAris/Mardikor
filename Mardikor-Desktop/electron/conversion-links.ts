import { parse, postprocess, preprocess } from "micromark";
import { gfmTable } from "micromark-extension-gfm-table";
import {
  normalizeReference,
  unescapeAll,
} from "markdown-it/lib/common/utils.mjs";

type Span = { start: number; end: number };
type Destination = Span & { url: string };
type Link = Span & {
  media: boolean;
  label?: Span;
  implicitReference?: string;
  reference?: string;
  destination?: Destination;
};
type Definition = { label?: string; destination?: Destination };
type Edit = Span & { text: string };
type ReferenceDecision = { href: string } | { skip: true } | undefined;

export function rewriteConversionLinks(
  source: string,
  resolve: (url: string, media: boolean) => ReferenceDecision,
) {
  if (!source.includes("[") && !source.includes("<")) return source;
  const bom = source.startsWith("\uFEFF") ? 1 : 0;
  const chunks = preprocess()(source.slice(bom), undefined, true);
  const events = postprocess(
    parse({ extensions: [gfmTable()] })
      .document()
      .write(chunks),
  );
  const stack: Link[] = [];
  const links: Link[] = [];
  const definitions = new Map<string, Destination>();
  let definition: Definition | undefined;
  for (const [event, token, context] of events) {
    const { type } = token;
    if (event === "exit") {
      if (type === "link" || type === "image" || type === "autolink")
        stack.pop();
      if (type === "definition") {
        if (
          definition?.label &&
          definition.destination &&
          !definitions.has(definition.label)
        )
          definitions.set(definition.label, definition.destination);
        definition = undefined;
      }
      continue;
    }
    const span = () => ({
      start: token.start.offset + bom,
      end: token.end.offset + bom,
    });
    const value = () => context.sliceSerialize(token);
    const destination = (): Destination => {
      const raw = value();
      return {
        ...span(),
        url: unescapeAll(raw.startsWith("<") ? raw.slice(1, -1) : raw),
      };
    };
    const link = stack.at(-1);
    switch (type) {
      case "link":
      case "image":
      case "autolink": {
        const entry = { ...span(), media: type === "image" };
        stack.push(entry);
        links.push(entry);
        break;
      }
      case "label":
        if (link) {
          const { start, end } = span();
          link.label = { start: start + (link.media ? 2 : 1), end: end - 1 };
        }
        break;
      case "labelText":
        if (link) link.implicitReference = normalizeReference(value());
        break;
      case "referenceString":
        if (link) link.reference = normalizeReference(value());
        break;
      case "resource":
        // Empty inline destinations are self-links, never shortcut references.
        if (link) link.implicitReference = undefined;
        break;
      case "resourceDestination":
        if (link) link.destination = destination();
        break;
      case "autolinkProtocol":
        if (link) link.destination = { ...span(), url: value() };
        break;
      case "definition":
        definition = {};
        break;
      case "definitionLabelString":
        if (definition) definition.label = normalizeReference(value());
        break;
      case "definitionDestination":
        if (definition) definition.destination = destination();
        break;
    }
  }

  const edits = new Map<number, Edit>();
  for (const link of links) {
    const reference = link.reference ?? link.implicitReference;
    const destination =
      link.destination ?? (reference ? definitions.get(reference) : undefined);
    if (!destination?.url) continue;
    const result = resolve(destination.url, link.media);
    if (!result) continue;
    if ("skip" in result) {
      // Keep the label and any nested image while removing the broken target.
      if (link.label) {
        edits.set(link.start, {
          start: link.start,
          end: link.label.start,
          text: "",
        });
        edits.set(link.label.end, {
          start: link.label.end,
          end: link.end,
          text: "",
        });
      } else {
        edits.set(link.start, { ...link, text: "" });
      }
    } else if (link.label) {
      edits.set(destination.start, {
        ...destination,
        text: "<" + result.href + ">",
      });
    } else {
      // A local file URI autolink needs ordinary link syntax after relocation.
      const label =
        result.href
          .replace(/[#?].*$/, "")
          .split("/")
          .at(-1) || result.href;
      edits.set(link.start, {
        ...link,
        text: "[" + label + "](<" + result.href + ">)",
      });
    }
  }
  if (!edits.size) return source;
  const parts: string[] = [];
  let cursor = 0;
  for (const { start, end, text } of [...edits.values()].sort(
    (a, b) => a.start - b.start,
  )) {
    parts.push(source.slice(cursor, start), text);
    cursor = end;
  }
  parts.push(source.slice(cursor));
  return parts.join("");
}
