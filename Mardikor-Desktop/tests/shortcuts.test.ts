import assert from "node:assert/strict";
import { test } from "node:test";
import {
  migrateShortcuts,
  shortcutError,
  shortcutFromEvent,
  shortcutKey,
  shortcutLabel,
  shortcuts,
} from "../shared/shortcuts";

test("visual commands use the requested platform defaults and native Mac labels", () => {
  const expected = [
    ["paragraph", "Ctrl+0", "⌘0"],
    ...Array.from({ length: 6 }, (_, i) => [
      `heading${i + 1}`,
      `Ctrl+${i + 1}`,
      `⌘${i + 1}`,
    ]),
    ["bold", "Ctrl+B", "⌘B"],
    ["italic", "Ctrl+I", "⌘I"],
    ["inlineCode", "Ctrl+E", "⌘E"],
    ["strike", "Ctrl+Shift+S", "⌘⇧X"],
    ["quote", "Ctrl+Shift+Q", "⌘⇧B"],
    ["orderedList", "Ctrl+Shift+7", "⌘⇧7"],
    ["bulletList", "Ctrl+Shift+8", "⌘⇧8"],
    ["taskList", "Ctrl+Shift+9", "⌘⇧9"],
    ["codeBlock", "Ctrl+Alt+C", "⌘⌥C"],
    ["rule", "Ctrl+Alt+R", "⌘⌥R"],
    ["link", "Ctrl+K", "⌘K"],
    ["unlink", "Ctrl+Shift+K", "⌘⇧K"],
    ["palette", "Ctrl+/", "⌘/"],
  ];
  for (const [id, other, mac] of expected) {
    const action = shortcuts.find((row) => row.id === id)!;
    assert.equal(shortcutKey(action, undefined, "other"), other);
    assert.equal(
      shortcutLabel(shortcutKey(action, undefined, "mac"), "mac"),
      mac,
    );
  }
  assert.equal(shortcutError({}, "mac"), undefined);
  assert.equal(shortcutError({}, "other"), undefined);
  assert.ok(shortcutError({ quote: "Ctrl+Shift+Q" }, "mac"));
});

test("legacy overrides and cleared bindings take priority over new defaults", () => {
  assert.deepEqual(
    migrateShortcuts(
      { heading2: "Ctrl+/", bold: null, save: "Ctrl+Shift+K" },
      "other",
    ),
    {
      heading2: "Ctrl+/",
      bold: null,
      save: "Ctrl+Shift+K",
      palette: null,
      unlink: null,
    },
  );
  assert.deepEqual(migrateShortcuts({ heading3: "Ctrl+Shift+B" }, "mac"), {
    heading3: "Ctrl+Shift+B",
    quote: null,
  });
  assert.equal(
    shortcutError(
      { palette: "Ctrl+Shift+/", image: "Ctrl+Alt+I", link: null },
      "other",
    ),
    undefined,
  );
  assert.ok(shortcutError({ image: "Ctrl+/" }, "other"));
  assert.ok(shortcutError({ image: "Ctrl+F" }, "other"));
});

test("slash recording uses the physical key and leaves IME, AltGraph and Mac Control alone", () => {
  const event = (overrides: Partial<KeyboardEvent> = {}) =>
    ({
      key: "/",
      code: "Slash",
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
      altKey: false,
      isComposing: false,
      keyCode: 191,
      getModifierState: () => false,
      ...overrides,
    }) as KeyboardEvent;
  assert.equal(shortcutFromEvent(event(), "other"), "Ctrl+/");
  assert.equal(
    shortcutFromEvent(event({ key: "?", shiftKey: true }), "other"),
    "Ctrl+Shift+/",
  );
  assert.equal(
    shortcutFromEvent(
      event({
        key: "ç",
        code: "KeyC",
        metaKey: true,
        ctrlKey: false,
        altKey: true,
      }),
      "mac",
    ),
    "Ctrl+Alt+C",
  );
  for (const extra of [
    { ctrlKey: false },
    { isComposing: true },
    { key: "Process" },
    { keyCode: 229 },
    { getModifierState: () => true },
  ])
    assert.equal(shortcutFromEvent(event(extra), "other"), undefined);
  assert.equal(shortcutFromEvent(event(), "mac"), undefined);
  assert.equal(
    shortcutFromEvent(event({ ctrlKey: false, metaKey: true }), "mac"),
    "Ctrl+/",
  );
});
