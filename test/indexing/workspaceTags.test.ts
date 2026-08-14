import assert = require("node:assert/strict");
import { test } from "node:test";
import type { IndexSnapshot, NoteRecord } from "../../src/domain/models";
import { workspaceTagNames, workspaceTags } from "../../src/indexing/workspaceTags";

/**
 * The workspace's tag vocabulary: what it says, and what it costs.
 *
 * The cost is the part worth pinning. The note editor asks for this on every index publish so
 * that typing `#` can offer what already exists, and counting the tags of a large workspace is
 * far more expensive than the edit that triggered the publish. Deriving it per call would put
 * that back into the typing path.
 */

function snapshotOf(tagsPerNote: readonly (readonly string[])[]): IndexSnapshot {
  const notes = Object.freeze(tagsPerNote.map((tags, index) => ({
    uri: `file:///notes/n${index}.md`,
    path: `n${index}.md`,
    title: `Note ${index}`,
    aliases: [],
    tags: Object.freeze([...tags]),
    headings: [],
    blockReferences: [],
    links: [],
    tasks: [],
    blocks: [],
    text: "",
    size: 0,
    modifiedAt: 0,
  } as unknown as NoteRecord)));
  return { notes, links: [], backlinks: [], tasks: [], version: 1, indexedAt: 0 };
}

test("every tag in the workspace is offered, most used first", () => {
  const snapshot = snapshotOf([
    ["reading"],
    ["project", "reading"],
    ["project"],
    ["project", "archive"],
  ]);

  assert.deepEqual(workspaceTagNames(snapshot), ["project", "reading", "archive"]);
});

test("a tag counted under two spellings is one tag, keeping the first seen", () => {
  const snapshot = snapshotOf([["Project"], ["project"], ["PROJECT"]]);

  assert.deepEqual(workspaceTags(snapshot), [{ tag: "Project", count: 3 }]);
});

test("tags used equally often are ordered by name so the menu never reshuffles", () => {
  const snapshot = snapshotOf([["beta"], ["alpha"]]);

  assert.deepEqual(workspaceTagNames(snapshot), ["alpha", "beta"]);
});

test("a workspace with no tags yet answers with an empty vocabulary", () => {
  assert.deepEqual(workspaceTagNames(snapshotOf([[], []])), []);
});

test("asking twice for the same commit does not count the notes twice", () => {
  /*
   * Identity, not equality. The editor asks for this on every publish, so a fresh array each
   * time means a fresh pass over every note in the workspace on every one — which is exactly
   * the per-keystroke cost the index was tuned to remove.
   */
  const snapshot = snapshotOf([["project"], ["reading"]]);

  assert.equal(
    workspaceTags(snapshot),
    workspaceTags(snapshot),
    "the vocabulary was recomputed rather than remembered against this commit",
  );
});

test("a new commit gets a new vocabulary rather than the previous one", () => {
  const before = snapshotOf([["project"]]);
  const after = snapshotOf([["project"], ["reading"]]);

  assert.deepEqual(workspaceTagNames(before), ["project"]);
  assert.deepEqual(
    workspaceTagNames(after),
    ["project", "reading"],
    "a tag gained by another note has to show up in the next publish",
  );
});
