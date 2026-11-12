import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { markdownHeadings } from "../shared/markdown";
import {
  findHeadings,
  searchDocuments,
  searchHit,
  searchPaths,
  searchPosition,
} from "../src/services/document-find";
import {
  createFindMapper,
  findLocations,
  mapFindLocation,
  projectFindHit,
} from "../src/services/find-mapping";
import { renderPreview } from "../src/services/preview";

test("search is literal, includes Markdown destinations and respects match case", async () => {
  const first = {
    path: "first",
    content: "\ufeff🐈[安装指南](https://example.com/docs)\r\n**甲**乙 A+B",
  };
  const second = { path: "second", content: "a+b 安装指南" };
  const docs = [first, second];
  const result = await searchDocuments(docs, "a+b", false);
  assert.equal(result.total, 2);
  assert.equal(searchHit(result, 0)?.start, first.content.indexOf("A+B"));
  assert.equal(searchHit(result, 1)?.path, "second");
  assert.equal(searchHit(result, 2), undefined);
  assert.equal((await searchDocuments(docs, "a+b", true)).total, 1);
  assert.equal(
    (await searchDocuments(docs, "https://example.com", false)).total,
    1,
  );
  assert.equal((await searchDocuments(docs, "甲乙", false)).total, 0);
  assert.equal((await searchDocuments(docs, "安装指南", false)).total, 2);
  assert.equal((await searchDocuments(docs, "", false)).total, 0);
  assert.deepEqual(searchPosition(first.content, first.content.indexOf("[")), {
    lineNumber: 1,
    column: 3,
  });
  assert.deepEqual(
    searchPosition(first.content, first.content.indexOf("A+B")),
    {
      lineNumber: 2,
      column: 8,
    },
  );
});

test("branch search includes only descendants of the selected entry and deduplicates paths", () => {
  const paths = [
    "root",
    "child",
    "grandchild",
    "sibling",
    "loose",
    "aliasChild",
  ].map((name) => "markdown/" + name + ".md");
  const [root, child, grandchild, sibling, loose, aliasChild] = paths;
  const project = {
    files: [...paths, "settings.toml", "resources/file.md"].map((path) => ({
      path,
      is_text: true,
      bytes: 5,
      kind: "text",
    })),
    contents: {
      schema_version: 1,
      entries: [
        { id: "1", path: root, position: "1" },
        { id: "1.1.1", path: grandchild, position: "1.1.1" },
        { id: "1.1", path: child, position: "1.1" },
        { id: "10", path: sibling, position: "10" },
        { id: "2", path: root, position: "2" },
        { id: "2.1", path: aliasChild, position: "2.1" },
      ],
    },
  };
  assert.deepEqual(searchPaths(project, { path: root }, "document"), [root]);
  assert.deepEqual(searchPaths(project, { path: root }, "branch"), [
    root,
    child,
    grandchild,
  ]);
  assert.deepEqual(searchPaths(project, { path: root, id: "2" }, "branch"), [
    root,
    aliasChild,
  ]);
  assert.deepEqual(searchPaths(project, { path: loose }, "branch"), [loose]);
  assert.deepEqual(searchPaths(project, { path: child }, "project"), [
    root,
    child,
    grandchild,
    aliasChild,
    sibling,
    loose,
  ]);
});

test("aborted source search cannot produce results", async () => {
  await assert.rejects(
    searchDocuments(
      [{ path: "file", content: "test" }],
      "test",
      true,
      AbortSignal.abort(),
    ),
    { name: "AbortError" },
  );
});

test("source locations map through markup, link targets, entities and repeated words", () => {
  const content =
    "# title\r\n\r\n[Same](https://example.com/Same) **Same** &amp;\r\n\r\n**甲**_乙_";
  const window = new Window();
  const body = window.document.createElement("div") as unknown as HTMLElement;
  body.innerHTML = renderPreview(
    content,
    undefined,
    "",
    "00",
    "",
    undefined,
    false,
    undefined,
    undefined,
    false,
    true,
  );
  function ranges(value: string, from?: number) {
    const start = content.indexOf(value, from);
    return mapFindLocation(body, content, {
      start,
      end: start + value.length,
      exact: true,
    }).ranges;
  }
  const emphasis = ranges("Same", content.indexOf("**"));
  assert.equal(emphasis[0].toString(), "Same");
  assert.equal(emphasis[0].startContainer.parentElement?.tagName, "STRONG");
  assert.equal(ranges("example.com")[0].toString(), "Same");
  assert.equal(ranges("&amp;")[0].toString(), "&");
  assert.deepEqual(ranges("**甲**_乙_").map(String), ["甲", "乙"]);
});

test("saved snapshots retain matching context and use an anchor for undisplayed edits", () => {
  const saved = "# Introduction\r\n\r\nSaved text is here.";
  const content = "Draft paragraph.\r\n\r\n" + saved;
  const hit = (word: string) => ({
    path: "example.md",
    content,
    start: content.indexOf(word),
    end: content.indexOf(word) + word.length,
  });
  assert.deepEqual(projectFindHit(hit("Saved"), saved), {
    start: saved.indexOf("Saved"),
    end: saved.indexOf("Saved") + 5,
    exact: true,
  });
  assert.equal(projectFindHit(hit("Draft"), saved).exact, false);
});

test("several hits in one block map independently and page slices clip boundary hits", async () => {
  const content = "word **word** [word](https://example.com/word)";
  const results = await searchDocuments(
    [{ path: "example.md", content }],
    "word",
    true,
  );
  const matches = { ...results.matches[0], length: results.length };
  const body = new Window().document.createElement(
    "div",
  ) as unknown as HTMLElement;
  body.innerHTML =
    '<p data-source-lines="0:1">word <strong>word</strong> <a>word</a></p>';
  const map = createFindMapper(body, content);
  assert.deepEqual(
    findLocations(matches, content).map((location) =>
      map(location).ranges.map(String),
    ),
    [["word"], ["word"], ["word"], ["word"]],
  );
  assert.deepEqual(findLocations(matches, content, 2, 7, -2), [
    { start: 0, end: 2, exact: true },
  ]);
});

test("outline hits are assigned to the closest containing heading", () => {
  const content =
    "found before\r\n\r\n# First\r\n\r\nfound\r\n\r\n## Child\r\n\r\nfound\r\n\r\n# End";
  const offsets = [...content.matchAll(/found/g)].map(({ index }) => index);
  const result = findHeadings(
    content,
    markdownHeadings(content),
    offsets,
    offsets[2],
  );
  assert.deepEqual([...result.matching], [0, 1]);
  assert.equal(result.active, 1);
});
