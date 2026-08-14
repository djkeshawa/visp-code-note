import assert = require("node:assert/strict");
import { test } from "node:test";
import { buildWorkspaceSearchResults } from "../../src/application/workspaceSearch";
import { createSearchRequest } from "../../src/application/workspaceSearchMatcher";
import { buildSnapshot } from "../../src/indexing/projections";
import { makeNote } from "../indexing/fixtures";

/**
 * Putting quotes around words is the one search convention every reader arrives already
 * knowing. These say what it has to do in a vault where the words are common but the phrase
 * is not — the situation the reader reaches for quotes in, and the only one where the
 * difference is visible.
 */

const notes = [
  makeNote({
    path: "notes/kickoff.md",
    content: "# Kickoff\nThe design review is on Thursday.\nBring the plan.\n",
  }),
  makeNote({
    path: "notes/scattered.md",
    content: "# Scattered\nA design note. A separate review of the roadmap.\n",
  }),
  makeNote({
    path: "notes/curly.md",
    content: "# Curly\nNotes from the retro session about naming.\n",
  }),
];
const snapshot = buildSnapshot(notes, 1, 1);
const paths = (query: string): string[] =>
  buildWorkspaceSearchResults(snapshot, query)
    .filter((result) => result.kind === "note")
    .map((result) => result.notePath);

test("a quoted phrase finds the note that says it, not every note with the words", () => {
  assert.deepEqual(paths("design review"), ["notes/kickoff.md", "notes/scattered.md"]);
  assert.deepEqual(paths("\"design review\""), ["notes/kickoff.md"]);
});

test("curly quotes are quotes too, because that is what a reader's keyboard produces", () => {
  assert.deepEqual(paths("“design review”"), ["notes/kickoff.md"]);
  // Half-corrected, which is what pasting from a document tends to give.
  assert.deepEqual(paths("“design review\""), ["notes/kickoff.md"]);
});

test("a phrase and loose words in one query all have to match", () => {
  assert.deepEqual(paths("\"design review\" Thursday"), ["notes/kickoff.md"]);
  assert.deepEqual(paths("\"design review\" roadmap"), []);
});

test("a quote the reader has not finished typing yet still narrows", () => {
  assert.deepEqual(paths("\"design rev"), ["notes/kickoff.md"]);
  assert.deepEqual(paths("\"design review\" \"Thurs"), ["notes/kickoff.md"]);
});

test("quotes around nothing are not a term to match", () => {
  // "" is not a word every note has to contain; it is a reader who typed the quotes first.
  assert.deepEqual(paths("\"\""), notes.map((note) => note.path).sort());
  assert.deepEqual(paths("\"\" retro"), ["notes/curly.md"]);
});

test("quotes that run together are read as separate phrases", () => {
  const request = createSearchRequest("\"design review\"\"on Thursday\"");
  assert.deepEqual(request.terms.map((term) => term.raw), ["design review", "on Thursday"]);
  assert.deepEqual(paths("\"design review\"\"on Thursday\""), ["notes/kickoff.md"]);

  // A quote inside a quote closes it; what follows is read the same way as any other query.
  assert.deepEqual(
    createSearchRequest("\"a \"b\" c\"").terms.map((term) => term.raw),
    ["a ", "b", " c"],
  );
});

test("an apostrophe is a letter, not a quote", () => {
  const request = createSearchRequest("don't stop");
  assert.deepEqual(request.terms.map((term) => term.raw), ["don't", "stop"]);
});
