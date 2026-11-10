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
import math from "@vscode/markdown-it-katex";
import { enablePreviewMath, renderPreview } from "../src/services/preview";
import {
  paginateMarkdown,
  replacePage,
  replacePages,
  type DocumentPages,
} from "../src/services/document-pages";
import {
  loadRichPages,
  richPageChanges,
  richPageParts,
  RichPages,
} from "../src/services/rich-pages";

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

test("visual editor keeps tight and loose bullet and ordered lists distinct", () => {
  for (const [first, second] of [
    ["- one", "- two"],
    ["1. one", "2. two"],
  ]) {
    assert.doesNotMatch(roundtrip(first + "\n" + second), /one\n\n/);
    assert.doesNotMatch(editor.getHTML(), /data-loose-list/);
    assert.match(roundtrip(first + "\n\n" + second), /one\n\n/);
    assert.match(editor.getHTML(), /data-loose-list/);
  }
});

test("visual editing round trips MDK containers and treats code fence markers as literal text", () => {
  const source =
    "## Title\n\n:::: note\nFirst **body**.\n\n:::tip\nNested text.\n:::\n\n```md\n::::\n```\n::::\n\nNext paragraph.";
  const output = roundtrip(source);
  assert.match(editor.getHTML(), /<aside[^>]+class="mdk-note"/);
  assert.match(editor.getHTML(), /<aside[^>]+class="mdk-tip"/);
  assert.match(output, /:::: note/);
  assert.match(output, /```md\n::::\n```/);
  assert.match(renderPreview(output), /<aside class="mdk-note">/);
  const quoted = roundtrip("> :::tip\n> 引用内提示。\n> :::");
  assert.match(quoted, /> :::tip/);
  assert.match(renderPreview(quoted), /<blockquote>[\s\S]*<aside class="mdk-tip">/);
  assert.equal(
    paginateMarkdown(source, 50).pages.some(({ readOnly }) => readOnly),
    false,
  );
});

test("visual page window preserves history and never inserts a paragraph at an internal heading boundary", () => {
  const paged = new Editor({
    extensions: [...editorExtensions(undefined, true), RichPages],
    contentType: "markdown",
  });
  try {
    const heading = { index: 0, text: "## First\n\n" };
    const body = { index: 1, text: "Second paragraph.\n\n" };
    loadRichPages(paged, [heading], new Map());
    assert.equal(paged.state.doc.childCount, 1);
    loadRichPages(paged, [heading, body], new Map([[0, heading.text]]));
    assert.deepEqual(
      richPageParts(paged.state).map(
        ({ fragment }) => fragment.firstChild?.type.name,
      ),
      ["heading", "paragraph"],
    );
    const before = paged.state;
    paged.view.dispatch(paged.state.tr.insertText(" edited", 6));
    const changes = richPageChanges(
      paged,
      before,
      paged.state.doc,
      richPageParts(paged.state),
    );
    assert.deepEqual(
      changes.map(({ index }) => index),
      [0],
    );
    loadRichPages(
      paged,
      [
        { ...heading, text: changes[0].text },
        body,
        { index: 2, text: "## End", final: true },
      ],
      new Map([
        [0, changes[0].text],
        [1, body.text],
      ]),
    );
    assert.equal(paged.state.doc.lastChild?.type.name, "paragraph");
    assert.ok(paged.commands.undo());
    assert.equal(paged.state.doc.firstChild?.textContent, "First");
    assert.equal(richPageParts(paged.state).length, 3);
  } finally {
    paged.destroy();
  }
});

test("joining across an internal page boundary and undoing restores the original CRLF source", () => {
  const paged = new Editor({
    extensions: [...editorExtensions(undefined, true), RichPages],
    contentType: "markdown",
  });
  try {
    const first = "alpha\r\n\r\n";
    const second = "beta\r\n\r\n";
    const source = first + second + "untouched";
    const layout: DocumentPages = {
      length: 2000,
      pages: [
        { start: 0, line: 1 },
        { start: first.length, line: 3 },
        { start: first.length + second.length, line: 5 },
      ],
    };
    loadRichPages(
      paged,
      [
        { index: 0, text: first },
        { index: 1, text: second },
      ],
      new Map(),
    );
    const before = paged.state;
    const [, boundary] = richPageParts(before);
    paged.view.dispatch(before.tr.delete(boundary.pos - 1, boundary.pos + 1));
    const merged = paged.state;
    const joined = replacePages(
      source,
      layout,
      richPageChanges(paged, before, merged.doc, richPageParts(merged)),
    );
    assert.equal(joined.content, "alphabeta\r\n\r\nuntouched");
    assert.ok(paged.commands.undo());
    const restored = replacePages(
      joined.content,
      joined.pagination,
      richPageChanges(
        paged,
        merged,
        paged.state.doc,
        richPageParts(paged.state),
      ),
    );
    assert.equal(restored.content, source);
  } finally {
    paged.destroy();
  }
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
    ":::note\n未闭合",
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

test("math preview renders inline and block MathML without enabling external content", () => {
  enablePreviewMath(math);
  const html = renderPreview(
    "能量 $E=mc^2$，代码 `$a+b$`。\n\n$$\n\\frac{a}{b}\n$$\n\n$\\includegraphics{https://example.com/image.png}$",
  );
  assert.match(html, /<math\b[^>]*><semantics>.*<msup>/s);
  assert.match(html, /<math[^>]+display="block".*<mfrac>/s);
  assert.match(html, /<code>\$a\+b\$<\/code>/);
  assert.doesNotMatch(html, /<img\b|href="https:\/\/example\.com/);
});

test("visual pagination preserves adjacent Markdown, CRLF, and links across page boundaries", () => {
  const intro = "链接 [阅读][guide] 和注释[^one]。\r\n\r\n";
  const source =
    intro +
    Array.from(
      { length: 42 },
      (_, i) => `## ${i + 1}\r\n\r\n${"正文。".repeat(80)}\r\n\r\n`,
    ).join("") +
    "[guide]: https://example.org/guide\r\n\r\n[^one]: 脚注正文。\r\n";
  const layout = paginateMarkdown(source, 2000);
  assert.ok(layout.pages.length >= 4);
  const start = layout.pages[1].start;
  const end = layout.pages[2].start;
  const changed = replacePage(source, layout, 1, "## 修改后的标题\n\n新正文");
  assert.equal(changed.content.slice(0, start), source.slice(0, start));
  assert.equal(
    changed.content.slice(changed.layout.pages[2].start),
    source.slice(end),
  );
  assert.equal(
    changed.content.slice(start, changed.layout.pages[2].start),
    "## 修改后的标题\r\n\r\n新正文\r\n\r\n",
  );
  const html = renderPreview(
    intro,
    undefined,
    "",
    "00",
    "",
    undefined,
    true,
    undefined,
    {
      headingOffset: 0,
      priorHeadingLevels: [],
      references: layout.references,
      notes: layout.notes,
    },
  );
  assert.match(html, /data-mdk-link="https:\/\/example\.org\/guide"/);
  assert.match(html, /脚注正文/);
});

test("very large lines and tables get bounded preview pages without editable fragments", () => {
  const huge = "🙂".repeat(1_050_000);
  const layout = paginateMarkdown(huge, 2001);
  assert.ok(layout.pages.length > 1000);
  assert.ok(
    layout.pages.every(
      ({ start, literal, readOnly }) => start % 2 === 0 && literal && readOnly,
    ),
  );
  const table =
    "# 表格压力测试\n\n| 项目 | 值 |\n| --- | --- |\n" +
    "| 表格数据 | 示例 |\n".repeat(3000);
  const paged = paginateMarkdown(table, 8000);
  assert.ok(paged.pages.length > 2);
  assert.ok(paged.pages.every(({ readOnly }) => readOnly));
  const first = renderPreview(table.slice(0, paged.pages[1].start));
  assert.match(first, /<h1[^>]*>表格压力测试<\/h1>/);
  assert.match(first, /<tbody>.*表格数据/s);
  assert.match(paged.pages[1].tableHeader ?? "", /^\| 项目 \| 值 \|/);
});
