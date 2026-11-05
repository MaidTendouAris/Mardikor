export interface MarkdownSyntax {
  id: string;
  label: string;
  group: string;
  example: string;
  sourceOnly?: boolean;
}
export const markdownSyntax: MarkdownSyntax[] = [
  ...Array.from({ length: 6 }, (_, i) => ({
    id: "heading" + (i + 1),
    label: i + 1 + " 级标题",
    group: "标题",
    example: "#".repeat(i + 1) + " 标题",
  })),
  { id: "bold", label: "加粗", group: "文本", example: "**文字**" },
  { id: "italic", label: "斜体", group: "文本", example: "*文字*" },
  { id: "strike", label: "删除线", group: "文本", example: "~~文字~~" },
  { id: "code", label: "行内代码", group: "文本", example: "`代码`" },
  { id: "quote", label: "引用", group: "段落", example: "> 引用内容" },
  {
    id: "bullet",
    label: "无序列表",
    group: "列表",
    example: "- 项目一\n- 项目二",
  },
  {
    id: "ordered",
    label: "有序列表",
    group: "列表",
    example: "1. 项目一\n2. 项目二",
  },
  {
    id: "task",
    label: "任务列表",
    group: "列表",
    example: "- [ ] 待办\n- [x] 已完成",
  },
  {
    id: "link",
    label: "链接",
    group: "插入",
    example: "[链接文字](https://example.com)",
  },
  {
    id: "image",
    label: "图片引用",
    group: "插入",
    example: "![图片说明](../resources/image/image.png)",
  },
  {
    id: "table",
    label: "表格",
    group: "插入",
    example: "| 标题一 | 标题二 |\n| --- | --- |\n| 内容 | 内容 |",
  },
  {
    id: "fence",
    label: "代码块",
    group: "插入",
    example: "```text\n代码\n```",
  },
  { id: "rule", label: "分隔线", group: "插入", example: "---" },
  { id: "break", label: "硬换行", group: "插入", example: "上一行  \n下一行" },
  {
    id: "autolink",
    label: "自动链接",
    group: "源码写法",
    example: "<https://example.com>",
  },
  {
    id: "reference",
    label: "引用式链接",
    group: "源码写法",
    example: '[链接文字][link-id]\n\n[link-id]: https://example.com "链接标题"',
    sourceOnly: true,
  },
  {
    id: "reference-image",
    label: "引用式图片",
    group: "源码写法",
    example:
      '![图片说明][image-id]\n\n[image-id]: ../resources/image/image.png "图片标题"',
    sourceOnly: true,
  },
  {
    id: "setext",
    label: "Setext 标题",
    group: "源码写法",
    example: "标题\n====",
  },
  {
    id: "indented-code",
    label: "缩进式代码块",
    group: "源码写法",
    example: "    代码行一\n    代码行二",
  },
  { id: "escape", label: "转义标点", group: "源码写法", example: "\\*文字\\*" },
  {
    id: "html",
    label: "原始 HTML",
    group: "源码写法",
    example: "<div>内容</div>",
    sourceOnly: true,
  },
];
export function markdownDestination(value: string) {
  return (
    "<" + value.replace(/[\s<>]/g, (char) => encodeURIComponent(char)) + ">"
  );
}
export function markdownTitle(value: string) {
  return value
    ? ' "' +
        value
          .replace(/[\\"]/g, (char) => "\\" + char)
          .replace(/[\r\n]+/g, " ") +
        '"'
    : "";
}
export function imageMarkdown(src: string, alt = "", title = "") {
  return (
    "![" +
    alt.replace(/[\\[\]]/g, (char) => "\\" + char).replace(/[\r\n]+/g, " ") +
    "](" +
    markdownDestination(src) +
    markdownTitle(title) +
    ")"
  );
}
export function codeFence(content: string, language = "") {
  const runs = content.match(/`+/g) ?? [];
  const fence = "`".repeat(Math.max(3, ...runs.map((run) => run.length + 1)));
  return (
    fence + language.replace(/[\r\n`]/g, "") + "\n" + content + "\n" + fence
  );
}
export function markdownInsertion(id: string, selected = "") {
  const text = selected || "文字";
  if (id === "escape") {
    const special = new Set("\\`*_{}[]()#+-.!>|~".split(""));
    return [...(selected || "*文字*")]
      .map((char) => (special.has(char) ? "\\" + char : char))
      .join("");
  }
  if (id === "setext") return (selected || "标题") + "\n====";
  if (/^heading[1-6]$/.test(id))
    return text
      .split(/\r?\n/)
      .map(
        (line) =>
          "#".repeat(Number(id.slice(-1))) +
          " " +
          line.replace(/^#{1,6}\s+/, ""),
      )
      .join("\n");
  if (id === "bold") return "**" + text + "**";
  if (id === "italic") return "*" + text + "*";
  if (id === "strike") return "~~" + text + "~~";
  if (id === "code") {
    const fence = "`".repeat(
      Math.max(1, ...(text.match(/`+/g) ?? []).map((s) => s.length + 1)),
    );
    const pad =
      text.startsWith("`") ||
      text.endsWith("`") ||
      (text.startsWith(" ") && text.endsWith(" ") && text.trim())
        ? " "
        : "";
    return fence + pad + text + pad + fence;
  }
  if (["quote", "bullet", "ordered", "task"].includes(id))
    return text
      .split(/\r?\n/)
      .map(
        (line, i) =>
          (id === "quote"
            ? "> "
            : id === "bullet"
              ? "- "
              : id === "task"
                ? "- [ ] "
                : i + 1 + ". ") + line,
      )
      .join("\n");
  if (id === "fence") return codeFence(selected || "代码", "text");
  if (id === "indented-code")
    return (selected || "代码")
      .split(/\r?\n/)
      .map((line) => "    " + line)
      .join("\n");
  if (id === "link")
    return (
      "[" + text.replace(/[\\[\]]/g, (c) => "\\" + c) + "](https://example.com)"
    );
  if (id === "image")
    return imageMarkdown(
      "../resources/image/image.png",
      selected || "图片说明",
    );
  return markdownSyntax.find((syntax) => syntax.id === id)?.example ?? "";
}
