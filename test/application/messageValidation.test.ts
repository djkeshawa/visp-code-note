import assert = require("node:assert/strict");
import { test } from "node:test";
import {
  isEditorMessage,
  isGraphMessage,
  isTasksMessage,
  isWorkspaceMessage,
} from "../../src/vscode/providers/messageValidation";

test("accepts continuous source edits with version and optional save intent", () => {
  assert.equal(isEditorMessage({
    type: "editor/editSource",
    start: 12,
    end: 16,
    source: "updated",
    expectedSource: "note",
    version: 7,
    sequence: 1,
  }), true);
  assert.equal(isEditorMessage({
    type: "editor/editSource",
    start: 0,
    end: 0,
    source: "# New note\n",
    expectedSource: "",
    version: 0,
    sequence: 2,
    save: true,
  }), true);
});

test("rejects malformed continuous source edits", () => {
  const valid = {
    type: "editor/editSource",
    start: 2,
    end: 4,
    source: "new",
    expectedSource: "old",
    version: 3,
    sequence: 1,
  } as const;

  for (const malformed of [
    { ...valid, start: -1 },
    { ...valid, start: 1.5 },
    { ...valid, end: 1 },
    { ...valid, source: 42 },
    { ...valid, expectedSource: undefined },
    { ...valid, version: -1 },
    { ...valid, version: Number.NaN },
    { ...valid, sequence: 0 },
    { ...valid, sequence: 1.5 },
    { ...valid, save: "yes" },
  ]) {
    assert.equal(isEditorMessage(malformed), false);
  }
});

test("validates explicit host-draft discard messages", () => {
  assert.equal(isEditorMessage({ type: "editor/discardDraft", version: 9 }), true);
  assert.equal(isEditorMessage({ type: "editor/discardDraft", version: -1 }), false);
  assert.equal(isEditorMessage({ type: "editor/discardDraft" }), false);
});

test("validates durable draft-stash messages", () => {
  assert.equal(isEditorMessage({
    type: "editor/stashDraft",
    source: "local draft",
    saveRequested: true,
  }), true);
  assert.equal(isEditorMessage({
    type: "editor/stashDraft",
    source: "local draft",
  }), false);
});

test("accepts versioned task toggles without echoing task content", () => {
  assert.equal(isTasksMessage({
    type: "tasks/toggle",
    noteUri: "file:///notes/tasks.md",
    start: 12,
    completed: false,
    version: 7,
  }), true);
});

test("rejects malformed or unversioned task toggles", () => {
  assert.equal(isTasksMessage({
    type: "tasks/toggle",
    noteUri: "file:///notes/tasks.md",
    start: 12,
    completed: false,
  }), false);
  assert.equal(isTasksMessage({
    type: "tasks/toggle",
    noteUri: "file:///notes/tasks.md",
    start: -1,
    completed: false,
    version: 7,
  }), false);
});

test("accepts a filter query and rejects one that could smuggle structure", () => {
  assert.equal(isWorkspaceMessage({ type: "workspace/filter", query: "meeting notes" }), true);
  assert.equal(isWorkspaceMessage({ type: "workspace/filter", query: "c++" }), true);
  assert.equal(isWorkspaceMessage({ type: "workspace/filter" }), false);
  assert.equal(isWorkspaceMessage({ type: "workspace/filter", query: 7 }), false);
  assert.equal(isWorkspaceMessage({ type: "workspace/filter", query: "a\nb" }), false);
  assert.equal(isWorkspaceMessage({ type: "workspace/filter", query: "x".repeat(10_000) }), false);
});

/*
 * The panel's two buttons. A command the validator does not know is dropped here without a
 * word, so the button in the panel would simply do nothing — which is how the empty state's
 * "Create your first note" would fail if this list and the protocol ever drifted apart.
 */
/*
 * `graph/focus` makes the host redraw around a URI a webview chose, in an extension that
 * supports untrusted workspaces. Shape is all this can check — whether a note by that name
 * is in the index is the panel's job — so it is checked exactly as `graph/open` is, and
 * these say so from both ends rather than letting one quietly accept more than the other.
 */
test("a focus request is checked the same way as an open request", () => {
  for (const type of ["graph/open", "graph/focus"]) {
    assert.equal(isGraphMessage({ type, uri: "file:///notes/atlas.md" }), true, type);
    assert.equal(isGraphMessage({ type }), false, type);
    assert.equal(isGraphMessage({ type, uri: 7 }), false, type);
    assert.equal(isGraphMessage({ type, uri: null }), false, type);
    assert.equal(isGraphMessage({ type, uri: ["file:///a.md"] }), false, type);
    assert.equal(isGraphMessage({ type, uri: { toString: "file:///a.md" } }), false, type);
    assert.equal(isGraphMessage({ type, uri: "x".repeat(10_000_001) }), false, type);
  }
  assert.equal(isGraphMessage({ type: "graph/refocus", uri: "file:///a.md" }), false);
});

test("the panel may run its own two commands and nothing else", () => {
  assert.equal(isWorkspaceMessage({ type: "workspace/runCommand", command: "search" }), true);
  assert.equal(isWorkspaceMessage({ type: "workspace/runCommand", command: "newNote" }), true);
  assert.equal(isWorkspaceMessage({ type: "workspace/runCommand", command: "deleteNote" }), false);
  assert.equal(
    isWorkspaceMessage({ type: "workspace/runCommand", command: "workbench.action.terminal.new" }),
    false,
  );
  assert.equal(isWorkspaceMessage({ type: "workspace/runCommand" }), false);
});
