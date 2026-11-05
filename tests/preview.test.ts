import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultSettings } from "../shared/defaults";
import { renderPreview } from "../src/services/preview";
import { validateSourceText } from "../shared/schema";
import { splitMarkdownByHeading, requiresSourceMode } from "../shared/markdown";
test("preview supports task lists and switches custom container rendering", () => {
  const settings = defaultSettings();
  const markdown = "- [x] 已完成\n- [ ] 待处理\n\n:::note\n正文\n:::\n";
  assert.match(renderPreview(markdown, settings), /type="checkbox"/);
  assert.match(renderPreview(markdown, settings), /mdk-note/);
  settings.preview.render_containers = false;
  assert.doesNotMatch(renderPreview(markdown, settings), /class="mdk-note"/);
});
test("preview title, table of contents, numbering and depth follow project settings", () => {
  const settings = defaultSettings(),
    markdown = "# 章标题\n\n## 小节\n\n### 细节\n";
  settings.mode.book.toc_depth = 1;
  const html = renderPreview(markdown, settings, "2", "01");
  assert.match(html, />2 章标题/);
  assert.match(html, />2\.1 小节/);
  const toc = html.match(/<nav[^>]*>([\s\S]*?)<\/nav>/)?.[1] ?? "";
  assert.match(toc, /章标题/);
  assert.doesNotMatch(toc, /小节/);
  settings.preview.show_title = false;
  settings.preview.show_toc = false;
  assert.doesNotMatch(renderPreview(markdown, settings), /<h1|<nav/);
});
test("inline source validation uses v1 contents and settings rules", () => {
  assert.throws(() => validateSourceText("contents.toml", "schema_version=2"));
  assert.throws(() =>
    validateSourceText(
      "contents.toml",
      "schema_version=1\n[appearance]\nfont_size=16",
    ),
  );
  assert.throws(() =>
    validateSourceText(
      "settings.toml",
      "schema_version=1\n[mode.book]\ntoc_depth=7",
    ),
  );
  assert.throws(() => validateSourceText("meta/annotations.json", '{"x":'));
  validateSourceText(
    "settings.toml",
    "schema_version=1\n[extension]\nunknown=true\n",
  );
});

test("chapter splitting follows parsed headings and preserves source bytes", () => {
  const source =
    "前言\r\n\r\n# 第一章\r\n\r\n```md\r\n# 示例\r\n```\r\n\r\n> # 引用\r\n\r\n## 子节\r\n\r\n# 第二章\r\n\r\n正文\r\n";
  const parts = splitMarkdownByHeading(source);
  assert.equal(parts.length, 2);
  assert(parts[0].startsWith("前言\r\n"));
  assert(parts[1].startsWith("# 第二章\r\n"));
  assert.equal(parts.join(""), source);
  assert.deepEqual(splitMarkdownByHeading("无标题\n"), ["无标题\n"]);
  const container = "# 一\n\n:::: note\n# 容器内标题\n::::\n\n# 二\n";
  assert.equal(splitMarkdownByHeading(container).length, 2);
  for (const source of [
    "::: note\n正文\n:::",
    "::::note\n:::tip\n正文\n:::\n::::",
    "> ::: note\n> 内容\n> :::",
  ])
    assert(requiresSourceMode(source));
});
