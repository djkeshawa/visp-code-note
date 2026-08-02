import assert = require("node:assert/strict");
import { test } from "node:test";
import {
  isEditorMessage,
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
