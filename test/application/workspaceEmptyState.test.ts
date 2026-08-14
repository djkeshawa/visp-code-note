import assert = require("node:assert/strict");
import { test } from "node:test";
import { workspaceEmptyState } from "../../src/webview/workspace/emptyState";

test("says nothing while there are notes to list", () => {
  assert.equal(workspaceEmptyState(true, 1), undefined);
  assert.equal(workspaceEmptyState(true, 570), undefined);
});

/*
 * The bug this exists for: an empty folder was told to open a folder holding Markdown files,
 * which is what had just been done, and there was nothing on the message to press.
 */
test("an open folder with no notes offers to write one instead of asking for a folder", () => {
  const state = workspaceEmptyState(true, 0);

  assert.notEqual(state, undefined);
  assert.doesNotMatch(state!.message, /open a folder/i);
  assert.doesNotMatch(state!.hint ?? "", /open a folder/i);
  assert.equal(state?.action?.label, "Create your first note");
  assert.equal(state?.action?.command, "newNote");
});

test("no folder open asks for the one thing that would help, and offers no button", () => {
  const state = workspaceEmptyState(false, 0);

  assert.match(state!.hint ?? "", /open a folder/i);
  // Opening a folder is VS Code's own command, so there is nothing here for the panel to run.
  assert.equal(state?.action, undefined);
});

test("the two empty workspaces do not say the same thing", () => {
  assert.notEqual(workspaceEmptyState(false, 0)?.message, workspaceEmptyState(true, 0)?.message);
});

/* First sentence of the product. It is a statement, not an outburst. */
test("no empty state shouts", () => {
  for (const state of [workspaceEmptyState(false, 0), workspaceEmptyState(true, 0)]) {
    assert.doesNotMatch(`${state?.message} ${state?.hint ?? ""}`, /!/);
    assert.notEqual(state?.icon, undefined);
  }
});
