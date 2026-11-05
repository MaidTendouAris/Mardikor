import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { AppState } from "../electron/state";

test("window drafts for the same document are isolated and survive restart", () => {
  const directory = fs.mkdtempSync(
    path.resolve(".test-artifacts/window-state-"),
  );
  const file = path.join(directory, "same.md");
  const state = new AppState(directory);
  const draft = (content: string) => ({
    revision: "revision",
    texts: [{ path: "same.md", content }],
  });
  // Legacy drafts remain recoverable, but can only be claimed by one window.
  state.recovery(file, draft("legacy"));
  assert.deepEqual(state.recovery(file, undefined, "left"), draft("legacy"));
  assert.equal(state.recovery(file, undefined, "right"), null);
  state.recovery(file, draft("left edit"), "left");
  state.recovery(file, draft("right edit"), "right");
  state.recovery(file, null, "left");
  assert.deepEqual(
    state.recovery(file, undefined, "right"),
    draft("right edit"),
  );
  const restarted = new AppState(directory);
  assert.deepEqual(
    restarted.recovery(file, undefined, "new"),
    draft("right edit"),
  );
  assert.equal(restarted.recovery(file, undefined, "other"), null);
  restarted.releaseRecovery("new");
  assert.deepEqual(
    restarted.recovery(file, undefined, "third"),
    draft("right edit"),
  );
  restarted.recovery(file, null, "third");
  assert.equal(restarted.recovery(file, undefined, "fourth"), null);
});
