import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildOutline,
  buildFileTree,
  moveOutline,
  moveOutlineToIndex,
  adjustOutline,
  removeOutline,
} from "../shared/tree";
import type { MdkEntry } from "../shared/mdk";
const fixture = (): MdkEntry[] => [
  { id: "a", path: "markdown/a.md", position: "1" },
  { id: "b", path: "markdown/b.md", position: "1.1" },
  { id: "c", path: "markdown/c.md", position: "1.1.1" },
  { id: "d", path: "markdown/d.md", position: "2" },
  { id: "e", path: "markdown/e.md", position: "3" },
];
test("tree hierarchy follows explicit positions, including missing parent entries", () => {
  const tree = buildOutline([
    { id: "child", path: "markdown/a.md", position: "2.10" },
    { id: "sibling", path: "markdown/b.md", position: "2.2" },
  ]);
  assert.equal(tree[0].position, "2");
  assert.equal(tree[0].entry, undefined);
  assert.deepEqual(
    tree[0].children.map((n) => n.entry?.id),
    ["sibling", "child"],
  );
});
test("dragging a subtree changes order and parent while preserving stable IDs and relative depth", () => {
  const moved = moveOutline(fixture(), "a", "2", "inside");
  assert.deepEqual(
    moved.map((e) => [e.id, e.position]),
    [
      ["d", "1"],
      ["a", "1.1"],
      ["b", "1.1.1"],
      ["c", "1.1.1.1"],
      ["e", "2"],
    ],
  );
  assert.deepEqual(
    new Set(moved.map((e) => e.id)),
    new Set(fixture().map((e) => e.id)),
  );
  const restored = adjustOutline(moved, "a", "outdent");
  assert.deepEqual(
    restored.map((e) => [e.id, e.position]),
    [
      ["d", "1"],
      ["a", "2"],
      ["b", "2.1"],
      ["c", "2.1.1"],
      ["e", "3"],
    ],
  );
});
test("drop before and after operates on complete subtrees", () => {
  const result = moveOutline(fixture(), "a", "3", "after");
  assert.deepEqual(
    result.map((e) => e.id),
    ["d", "e", "a", "b", "c"],
  );
  assert.equal(result.find((e) => e.id === "c")?.position, "3.1.1");
  assert.deepEqual(moveOutlineToIndex(fixture(), "a", null, 1), fixture());
  assert.equal(
    moveOutlineToIndex(fixture(), "d", "1", 0).find((e) => e.id === "d")
      ?.position,
    "1.1",
  );
});
test("cycles and depth beyond six are rejected without mutating entries", () => {
  const entries = fixture(),
    before = structuredClone(entries);
  assert.throws(() => moveOutline(entries, "a", "1.1", "inside"));
  const deep = [
    { id: "root", path: "markdown/root.md", position: "1.1.1.1.1.1" },
    { id: "next", path: "markdown/next.md", position: "2" },
  ];
  assert.throws(() => moveOutline(deep, "next", "1.1.1.1.1.1", "inside"));
  assert.deepEqual(entries, before);
});
test("physical explorer builds folders independently of logical outline positions", () => {
  const tree = buildFileTree([
    { path: "settings.toml", kind: "control", bytes: 12 },
    { path: "markdown/part/中文.md", kind: "markdown", bytes: 7 },
    { path: "meta", kind: "directory", bytes: 0 },
  ]);
  assert.deepEqual(
    tree.map((n) => n.name),
    ["markdown", "meta", "settings.toml"],
  );
  assert.equal(tree[0].children[0].children[0].path, "markdown/part/中文.md");
});

test("deletion promotes only actual children and retains unrelated missing-parent branches", () => {
  const entries = [
    ...fixture(),
    { id: "gap", path: "markdown/gap.md", position: "8.2" },
  ];
  const result = removeOutline(entries, "a");
  assert.deepEqual(
    result.map((e) => [e.id, e.position]),
    [
      ["b", "1"],
      ["c", "1.1"],
      ["d", "2"],
      ["e", "3"],
      ["gap", "4.1"],
    ],
  );
});
