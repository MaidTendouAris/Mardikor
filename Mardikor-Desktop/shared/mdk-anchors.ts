import type Token from "markdown-it/lib/token.mjs";
import { assignedUnicode151, outsideHeadingUnicode151 } from "./unicode-15-1";

// Normalization is stable for characters assigned in 15.1. Characters added
// later remain inert boundaries, as they would on the reference version.
function normalizeUnicode151(text: string) {
  return text.replace(assignedUnicode151, (run) => run.normalize("NFC"));
}

export function headingText(tokens: Token[]): string {
  return tokens
    .map((token) => {
      if (["text", "code_inline", "html_inline"].includes(token.type))
        return token.content;
      if (token.type === "image") return headingText(token.children ?? []);
      return ["softbreak", "hardbreak"].includes(token.type) ? " " : "";
    })
    .join("");
}

export function legacyHeadingAnchor() {
  const fragments = new Set<string>(), counts = new Map<string, number>();
  return (title: string) => {
    const base = title
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, "")
      .replace(/\s+/g, "-");
    let count = counts.get(base) ?? 0;
    let fragment = count ? base + "-" + count : base;
    while (fragments.has(fragment)) fragment = base + "-" + ++count;
    counts.set(base, count + 1);
    fragments.add(fragment);
    return fragment;
  };
}

export function v2HeadingAnchors(tokens: Token[]) {
  const whiteSpace =
    // oxlint-disable-next-line eslint/no-control-regex -- Unicode 15.1 White_Space includes TAB, LF, VT, FF, CR and NEL.
    /[\u0009-\u000d \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/gu;
  const used = new Set<string>(),
    anchors = new Map<number, string>();
  tokens.forEach((token, index) => {
    if (token.type !== "heading_open") return;
    const label = normalizeUnicode151(
      headingText(tokens[index + 1]?.children ?? []),
    )
      .replace(/[A-Z]/g, (value) => value.toLowerCase())
      .replace(whiteSpace, "-")
      .replace(outsideHeadingUnicode151, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    const base = "h-" + (label || "section");
    let id = base;
    for (let suffix = 2; used.has(id); suffix++) id = base + "-" + suffix;
    used.add(id);
    anchors.set(index, id);
  });
  return anchors;
}
