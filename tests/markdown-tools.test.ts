import assert from "node:assert/strict";
import { test, after } from "node:test";
import { Editor, type JSONContent } from "@tiptap/core";
import { Window } from "happy-dom";
import {
  editorExtensions,
  alignTableColumns,
} from "../src/services/rich-markdown";
import { requiresSourceMode } from "../shared/markdown";
import {
  markdownInsertion,
  imageMarkdown,
  codeFence,
} from "../shared/markdown-editing";
import { renderPreview } from "../src/services/preview";

const window = new Window();
Object.assign(globalThis, {
  window,
  document: window.document,
  Node: window.Node,
  DOMParser: window.DOMParser,
  XMLSerializer: window.XMLSerializer,
});
Object.defineProperty(globalThis, "navigator", {
  value: window.navigator,
  configurable: true,
});
const editor = new Editor({
  extensions: editorExtensions(),
  contentType: "markdown",
});
after(() => {
  editor.destroy();
  window.happyDOM.abort();
});
function canonical(node: JSONContent): unknown {
  const attrs = Object.fromEntries(
    Object.entries(node.attrs ?? {}).filter(
      ([, value]) => value !== null && value !== undefined,
    ),
  );
  return {
    type: node.type,
    ...(node.text === undefined ? {} : { text: node.text }),
    ...(Object.keys(attrs).length ? { attrs } : {}),
    ...(node.content ? { content: node.content.map(canonical) } : {}),
    ...(node.marks ? { marks: node.marks.map(canonical) } : {}),
  };
}
function roundtrip(source: string) {
  editor.commands.setContent(source, { contentType: "markdown" });
  const before = canonical(editor.getJSON());
  const output = editor.getMarkdown();
  editor.commands.setContent(output, { contentType: "markdown" });
  assert.deepEqual(canonical(editor.getJSON()), before, output);
  assert.equal(requiresSourceMode(output), false, output);
  return output;
}
test("visual Markdown round trips headings, nested lists, marks, links, escapes, rules and hard breaks", () => {
  roundtrip(
    '# 一\n\n## 二\n\n### 三\n\n#### 四\n\n##### 五\n\n###### 六\n\n**加粗** *斜体* ***组合*** ~~删除~~ `code`\\*字面标点\\*\n\n> 引用\n>\n> - 子项目\n\n- 项目\n  - 嵌套\n\n3. 三\n4. 四\n\n- [ ] 待办\n- [x] 完成\n\n[链接](<https://example.com/a%20b> "标题")\n\n---\n\n上一行  \n下一行\n',
  );
});
test("GFM tables retain alignment, escaped pipes and inline formatting", () => {
  const result = roundtrip(
    "| 左 | 中 | 右 |\n| :--- | :---: | ---: |\n| **粗体** | `a\\|b` | [链接](https://example.com) |\n",
  );
  assert.match(result, /:---+/);
  assert.match(result, /---+:/);
  assert.match(result, /a\\\|b/);
  assert.match(renderPreview(result), /text-align:center/);
});
test("table column alignment and row operations persist as valid GFM", () => {
  editor.commands.setContent("| A | B |\n| --- | --- |\n| X | Y |", {
    contentType: "markdown",
  });
  let cell = -1;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "tableCell" && cell < 0) cell = pos + 2;
  });
  editor.commands.setTextSelection(cell);
  editor.commands.setHardBreak();
  assert.doesNotMatch(editor.getMarkdown(), /<br>/);
  assert(alignTableColumns(editor, "right"));
  editor.commands.addRowBefore();
  const output = editor.getMarkdown();
  assert.match(output, /---+:/);
  roundtrip(output);
});
test("links, images and code fences preserve punctuation, titles and embedded backticks", () => {
  const source = imageMarkdown(
    "../resources/image/a b(1).png",
    "说明 [1]",
    '标题 "引号"',
  );
  assert.match(roundtrip(source), /%20/);
  assert.match(roundtrip("前文 " + source + " 后文"), /前文 !\[.* 后文/);
  roundtrip("| 图片 | 内容 |\n| --- | --- |\n| " + source + " | **说明** |");
  const code = "````\n```js\nconst x = 1\n```\n````";
  roundtrip(code);
  roundtrip(codeFence("<div>\n:::note\n[ref]: fake\n</div>", "html"));
  roundtrip('[说明](<https://example.com/a(1)> "标题 \\\"引号\\\"")');
});
test("source-only detection allows tables and code examples but protects references, containers and raw HTML", () => {
  for (const source of [
    "| A | B |\n| --- | --- |\n| X | Y |",
    "```md\n:::note\n[ref]: target\n<b>example</b>\n```",
    "`<img src=x>`",
    "<https://example.com>",
  ])
    assert.equal(requiresSourceMode(source), false, source);
  for (const source of [
    "Text <script>alert(1)</script>",
    "[name][id]\n\n[id]: https://example.com",
    "[^note]: 内容",
    ":::note\n内容\n:::",
    "<br onclick=alert(1)>",
    "A<br>B",
  ])
    assert.equal(requiresSourceMode(source), true, source);
  assert.doesNotMatch(renderPreview("<br onclick=alert(1)>"), /<br onclick/);
  assert.match(renderPreview("A<br>B"), /A&lt;br&gt;B/);
});
test("source formatting generates safe inline code, fenced blocks and nested paragraphs", () => {
  assert.equal(markdownInsertion("heading6", "标题"), "###### 标题");
  assert.equal(markdownInsertion("ordered", "一\n二"), "1. 一\n2. 二");
  assert.match(markdownInsertion("code", "a`b"), /^``a`b``$/);
  assert.equal(markdownInsertion("code", " a "), "`  a  `");
  assert.equal(markdownInsertion("indented-code", "一\n二"), "    一\n    二");
  assert.equal(markdownInsertion("quote", "一\n二"), "> 一\n> 二");
});
