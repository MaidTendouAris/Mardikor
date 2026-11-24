import { t, translations } from "./i18n";
type Message = Parameters<typeof t>[0];
export interface MarkdownSyntax {
  id: string;
  label: string;
  group: string;
  example: string;
  search: readonly string[];
  sourceOnly?: boolean;
}
function syntax(
  id: string,
  label: Message,
  group: Message,
  example: () => string,
  sourceOnly = false,
): MarkdownSyntax {
  return {
    id,
    get label() {
      return t(label);
    },
    get group() {
      return t(group);
    },
    get example() {
      return example();
    },
    search: translations(label),
    sourceOnly,
  };
}

export const markdownSyntax: MarkdownSyntax[] = [
  ...Array.from({ length: 6 }, (_, i) => ({
    id: "heading" + (i + 1),
    get label() {
      return i + 1 + t(" 级标题");
    },
    get group() {
      return t("标题");
    },
    get example() {
      return "#".repeat(i + 1) + t(" 标题");
    },
    search: translations("标题"),
  })),
  syntax("bold", "加粗", "文本", () => t("**文字**")),
  syntax("italic", "斜体", "文本", () => t("*文字*")),
  syntax("strike", "删除线", "文本", () => t("~~文字~~")),
  syntax("code", "行内代码", "文本", () => t("`代码`")),
  syntax("quote", "引用", "段落", () => t("> 引用内容")),
  syntax("bullet", "无序列表", "列表", () => t("- 项目一\n- 项目二")),
  syntax("ordered", "有序列表", "列表", () => t("1. 项目一\n2. 项目二")),
  syntax("task", "任务列表", "列表", () => t("- [ ] 待办\n- [x] 已完成")),
  syntax("link", "链接", "插入", () => t("[链接文字](https://example.com)")),
  syntax("image", "图片引用", "插入", () =>
    t("![图片说明](../resources/image/image.png)"),
  ),
  syntax("table", "表格", "插入", () =>
    t("| 标题一 | 标题二 |\n| --- | --- |\n| 内容 | 内容 |"),
  ),
  syntax("fence", "代码块", "插入", () => t("```text\n代码\n```")),
  syntax("rule", "分隔线", "插入", () => "---"),
  syntax("break", "硬换行", "插入", () => t("上一行  \n下一行")),
  syntax("autolink", "自动链接", "源码写法", () => "<https://example.com>"),
  syntax(
    "reference",
    "引用式链接",
    "源码写法",
    () => t('[链接文字][link-id]\n\n[link-id]: https://example.com "链接标题"'),
    true,
  ),
  syntax(
    "reference-image",
    "引用式图片",
    "源码写法",
    () =>
      t(
        '![图片说明][image-id]\n\n[image-id]: ../resources/image/image.png "图片标题"',
      ),
    true,
  ),
  syntax("setext", "Setext 标题", "源码写法", () => t("标题\n====")),
  syntax("indented-code", "缩进式代码块", "源码写法", () =>
    t("    代码行一\n    代码行二"),
  ),
  syntax("escape", "转义标点", "源码写法", () => t("\\*文字\\*")),
  syntax("math-inline", "行内公式", "源码写法", () => "$E=mc^2$", true),
  syntax(
    "math-block",
    "块级公式",
    "源码写法",
    () => "$$\n\\frac{a}{b}\n$$",
    true,
  ),
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
