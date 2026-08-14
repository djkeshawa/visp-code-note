import assert = require("node:assert/strict");
import { test } from "node:test";
import { isEditorState, isWorkspaceTags } from "../../src/webview/editor/validation";

/**
 * The tag vocabulary's trip across the host/webview wire.
 *
 * A field the validator does not know about is dropped, reads `undefined` in the page, and a
 * completion source handed `undefined` offers nothing and reports nothing — the feature is
 * simply absent, with no error anywhere to say so. That is the failure this file exists to
 * make loud.
 */

const STATE = Object.freeze({
  uri: "file:///notes/atlas.md",
  title: "Atlas",
  source: "# Atlas\n",
  unresolvedLinks: [],
  version: 3,
  dirty: false,
  noteSuggestions: [],
  contentWidth: "readable",
  brokenLinkCount: 0,
  showInspector: true,
  personalDictionary: [],
  spellingEnabled: true,
  workspaceTags: ["project", "reading"],
});

test("an editor state carrying the workspace's tags is accepted", () => {
  assert.equal(isEditorState(STATE), true);
});

test("an editor state with no tag list at all is rejected rather than silently accepted", () => {
  const { workspaceTags: _dropped, ...without } = STATE;

  assert.equal(
    isEditorState(without),
    false,
    "accepting this would leave the `#` menu permanently empty and say nothing about it",
  );
});

test("a tag list that is not a list of strings is rejected", () => {
  assert.equal(isEditorState({ ...STATE, workspaceTags: "project" }), false);
  assert.equal(isEditorState({ ...STATE, workspaceTags: [1, 2] }), false);
  assert.equal(isEditorState({ ...STATE, workspaceTags: [null] }), false);
});

test("an empty vocabulary is a real answer, not a missing one", () => {
  assert.equal(isEditorState({ ...STATE, workspaceTags: [] }), true);
  assert.equal(isWorkspaceTags([]), true);
});
