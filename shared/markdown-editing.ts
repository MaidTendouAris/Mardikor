import { t } from "./i18n";
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
    label: i + 1 + t(" 级标题"),
    group: t("标题"),
    example: "#".repeat(i + 1) + t(" 标题"),
  })),
  { id: "bold", label: t("加粗"), group: t("文本"), example: t("**文字**") },
  { id: "italic", label: t("斜体"), group: t("文本"), example: t("*文字*") },
  {
    id: "strike",
    label: t("删除线"),
    group: t("文本"),
    example: t("~~文字~~"),
  },
  { id: "code", label: t("行内代码"), group: t("文本"), example: t("`代码`") },
  { id: "quote", label: t("引用"), group: t("段落"), example: t("> 引用内容") },
  {
    id: "bullet",
    label: t("无序列表"),
    group: t("列表"),
    example: t("- 项目一\n- 项目二"),
  },
  {
    id: "ordered",
    label: t("有序列表"),
    group: t("列表"),
    example: t("1. 项目一\n2. 项目二"),
  },
  {
    id: "task",
    label: t("任务列表"),
    group: t("列表"),
    example: t("- [ ] 待办\n- [x] 已完成"),
  },
  {
    id: "link",
    label: t("链接"),
    group: t("插入"),
    example: t("[链接文字](https://example.com)"),
  },
  {
    id: "image",
    label: t("图片引用"),
    group: t("插入"),
    example: t("![图片说明](../resources/image/image.png)"),
  },
  {
    id: "table",
    label: t("表格"),
    group: t("插入"),
    example: t("| 标题一 | 标题二 |\n| --- | --- |\n| 内容 | 内容 |"),
  },
  {
    id: "fence",
    label: t("代码块"),
    group: t("插入"),
    example: t("```text\n代码\n```"),
  },
  { id: "rule", label: t("分隔线"), group: t("插入"), example: "---" },
  {
    id: "break",
    label: t("硬换行"),
    group: t("插入"),
    example: t("上一行  \n下一行"),
  },
  {
    id: "autolink",
    label: t("自动链接"),
    group: t("源码写法"),
    example: "<https://example.com>",
  },
  {
    id: "reference",
    label: t("引用式链接"),
    group: t("源码写法"),
    example: t(
      '[链接文字][link-id]\n\n[link-id]: https://example.com "链接标题"',
    ),
    sourceOnly: true,
  },
  {
    id: "reference-image",
    label: t("引用式图片"),
    group: t("源码写法"),
    example: t(
      '![图片说明][image-id]\n\n[image-id]: ../resources/image/image.png "图片标题"',
    ),
    sourceOnly: true,
  },
  {
    id: "setext",
    label: t("Setext 标题"),
    group: t("源码写法"),
    example: t("标题\n===="),
  },
  {
    id: "indented-code",
    label: t("缩进式代码块"),
    group: t("源码写法"),
    example: t("    代码行一\n    代码行二"),
  },
  {
    id: "escape",
    label: t("转义标点"),
    group: t("源码写法"),
    example: t("\\*文字\\*"),
  },
  {
    id: "math-inline",
    label: t("行内公式"),
    group: t("源码写法"),
    example: "$E=mc^2$",
    sourceOnly: true,
  },
  {
    id: "math-block",
    label: t("块级公式"),
    group: t("源码写法"),
    example: "$$\n\\frac{a}{b}\n$$",
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
  const text = selected || t("文字");
  if (id === "escape") {
    const special = new Set("\\`*_{}[]()#+-.!>|~".split(""));
    return [...(selected || t("*文字*"))]
      .map((char) => (special.has(char) ? "\\" + char : char))
      .join("");
  }
  if (id === "setext") return (selected || t("标题")) + "\n====";
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
  if (id === "fence") return codeFence(selected || t("代码"), "text");
  if (id === "indented-code")
    return (selected || t("代码"))
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
      selected || t("图片说明"),
    );
  return markdownSyntax.find((syntax) => syntax.id === id)?.example ?? "";
}
