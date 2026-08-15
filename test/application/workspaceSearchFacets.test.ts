import assert = require("node:assert/strict");
import { test } from "node:test";
import type { NoteRecord } from "../../src/domain/models";
import { buildWorkspaceSearchResults, matchingNoteUris } from "../../src/application/workspaceSearch";
import { createSearchRequest } from "../../src/application/workspaceSearchMatcher";
import { buildSnapshot } from "../../src/indexing/projections";
import { makeNote } from "../indexing/fixtures";

/**
 * `path:`, `tag:`, `is:` and `modified:` — the way a query says "not everywhere".
 *
 * Two things are being pinned here. The first is the grammar, which is where a search
 * language fails: a facet with nothing after the colon, a colon inside a value, a name
 * nobody implemented, a colon in ordinary prose. Each row below is a decision, and the
 * test name is where the decision is written down.
 *
 * The second is that a facet never reaches the text index as a word to look for. It has
 * no failure of its own — the search simply returns nothing, while looking like it worked.
 */

const DAY = 24 * 60 * 60 * 1000;

/** `modifiedAt` is on every record; these fixtures are the only place it is chosen. */
function modifiedOn(note: NoteRecord, year: number, month: number, day: number): NoteRecord {
  return { ...note, modifiedAt: new Date(year, month - 1, day, 9).getTime() };
}

const notes = [
  modifiedOn(
    makeNote({
      path: "meetings/q3-planning.md",
      content: [
        "---",
        "tags: [finance]",
        "---",
        "# Q3 planning",
        "The budget is agreed.",
        "",
        "- [ ] Send the budget to accounts",
        "- [x] Book the room",
        "",
      ].join("\n"),
    }),
    2026, 8, 12,
  ),
  modifiedOn(
    makeNote({
      path: "journal/2026-07-15.md",
      content: "# Journal\nThought about the budget again.\n",
    }),
    2026, 7, 15,
  ),
  modifiedOn(
    makeNote({ path: "notes/ratios.md", content: "# Ratios\nA contrast ratio 3:1 is the floor.\n" }),
    2026, 7, 15,
  ),
  modifiedOn(
    makeNote({
      path: "my notes/inbox.md",
      content: "# Inbox\nA budget note in a folder whose name has a space.\n",
    }),
    2026, 7, 15,
  ),
];
const snapshot = buildSnapshot(notes, 1, 1);

const notePaths = (query: string): string[] =>
  buildWorkspaceSearchResults(snapshot, query)
    .filter((result) => result.kind === "note")
    .map((result) => result.notePath);

const taskTexts = (query: string): string[] =>
  buildWorkspaceSearchResults(snapshot, query)
    .filter((result) => result.kind === "task")
    .map((result) => result.displayText)
    .sort();

test("a facet never becomes a word the text index is asked to find", () => {
  /*
   * The whole difficulty of this feature in one assertion. Handed to the trigram narrowing
   * as a term, `path:meetings` narrows the query to notes whose text literally contains
   * "path:meetings" — no note does, so the answer is empty and nothing says why.
   */
  assert.deepEqual(notePaths("path:meetings budget"), ["meetings/q3-planning.md"]);
  assert.deepEqual(notePaths("path:journal budget"), ["journal/2026-07-15.md"]);
  assert.deepEqual(createSearchRequest("path:meetings budget").terms.map((term) => term.raw), [
    "budget",
  ]);
});

test("a facet on its own is a query, with no word to match at all", () => {
  assert.deepEqual(notePaths("path:meetings"), ["meetings/q3-planning.md"]);
  assert.deepEqual(notePaths("tag:finance"), ["meetings/q3-planning.md"]);
});

test("a facet with no value yet is one being typed, not a filter that empties the list", () => {
  // Half a facet is what every faceted query looks like one keystroke in.
  assert.equal(createSearchRequest("path:").filters.paths.length, 0);
  assert.deepEqual(createSearchRequest("path:").terms, []);
  assert.equal(notePaths("path:").length, notes.length);
  assert.deepEqual(notePaths("path: budget").sort(), notePaths("budget").sort());
});

test("a facet value keeps every colon after the first one", () => {
  assert.deepEqual(createSearchRequest("path:meetings/2026:08").filters.paths, [
    "meetings/2026:08",
  ]);
  assert.deepEqual(createSearchRequest("tag:project:atlas").filters.tags, ["project:atlas"]);
});

test("a quoted facet value is one value, spaces and all", () => {
  assert.deepEqual(createSearchRequest("path:\"my notes\"").filters.paths, ["my notes"]);
  assert.deepEqual(createSearchRequest("path:\"my notes\"").terms, []);
  assert.deepEqual(notePaths("path:\"my notes\""), ["my notes/inbox.md"]);
  // Curly quotes are quotes here for the same reason they are around a phrase.
  assert.deepEqual(createSearchRequest("path:“my notes”").filters.paths, ["my notes"]);
});

test("quoting the whole facet asks for the text, because that is what quotes mean", () => {
  assert.deepEqual(createSearchRequest("\"path:meetings\"").terms.map((term) => term.raw), [
    "path:meetings",
  ]);
  assert.equal(createSearchRequest("\"path:meetings\"").filters.paths.length, 0);
  assert.deepEqual(notePaths("\"path:meetings\""), []);
});

test("a facet counts wherever it is written, not only at the front of the query", () => {
  assert.deepEqual(notePaths("budget path:journal"), notePaths("path:journal budget"));
  assert.deepEqual(notePaths("budget path:journal"), ["journal/2026-07-15.md"]);
  // The name is matched without case; nothing else in this query is case-sensitive either.
  assert.deepEqual(createSearchRequest("PATH:Meetings").filters.paths, ["meetings"]);
});

test("a facet nobody implemented is text to search for, never a filter that vanishes", () => {
  /*
   * Dropping it would answer `author:kim budget` with every note that says budget — the
   * silent wrong answer this project keeps closing. It matches nothing instead, which the
   * reader can see and correct.
   */
  assert.deepEqual(createSearchRequest("author:kim budget").terms.map((term) => term.raw), [
    "author:kim",
    "budget",
  ]);
  assert.deepEqual(notePaths("author:kim budget"), []);
  assert.equal(notePaths("budget").length, 3);
});

test("a repeated facet narrows, exactly as a repeated word does", () => {
  // AND, not OR: every other token in this query language narrows, and a reader cannot tell
  // from looking which rule a token is under. Both have to hold.
  assert.deepEqual(createSearchRequest("tag:finance tag:archive").filters.tags, [
    "finance",
    "archive",
  ]);
  assert.deepEqual(notePaths("path:meetings path:planning"), ["meetings/q3-planning.md"]);
  assert.deepEqual(notePaths("tag:finance tag:archive"), []);
  // Which makes this one empty, truthfully: nothing is both a note and a task.
  assert.deepEqual(buildWorkspaceSearchResults(snapshot, "is:note is:task"), []);
});

test("a colon in ordinary prose is not a facet", () => {
  assert.deepEqual(createSearchRequest("ratio 3:1").terms.map((term) => term.raw), ["ratio", "3:1"]);
  assert.deepEqual(notePaths("ratio 3:1"), ["notes/ratios.md"]);
  assert.deepEqual(notePaths("3:1"), ["notes/ratios.md"]);
});

test("modified: reads a span back from now, or a date to count from", () => {
  const now = new Date(2026, 7, 14, 12).getTime();

  assert.deepEqual(createSearchRequest("modified:7d", now).filters.modifiedSince, [now - 7 * DAY]);
  assert.deepEqual(createSearchRequest("modified:12h", now).filters.modifiedSince, [
    now - 12 * 60 * 60 * 1000,
  ]);
  assert.deepEqual(createSearchRequest("modified:2w", now).filters.modifiedSince, [now - 14 * DAY]);
  assert.deepEqual(createSearchRequest("modified:2026-08-01", now).filters.modifiedSince, [
    new Date(2026, 7, 1).getTime(),
  ]);
  assert.deepEqual(createSearchRequest("modified:today", now).filters.modifiedSince, [
    new Date(2026, 7, 14).getTime(),
  ]);
});

test("modified: narrows to what moved since, and leaves the rest out", () => {
  assert.deepEqual(notePaths("modified:2026-08-01 budget"), ["meetings/q3-planning.md"]);
  assert.deepEqual(notePaths("modified:2026-07-01 budget").sort(), notePaths("budget").sort());
});

test("modified: with a value it cannot read stays text, rather than filtering by nothing", () => {
  assert.deepEqual(createSearchRequest("modified:banana").terms.map((term) => term.raw), [
    "modified:banana",
  ]);
  assert.equal(createSearchRequest("modified:banana").filters.modifiedSince.length, 0);
  assert.deepEqual(notePaths("modified:banana"), []);
  // A day that does not exist is a value it cannot read.
  assert.equal(createSearchRequest("modified:2026-02-31").filters.modifiedSince.length, 0);
});

test("is: separates notes from tasks, and open tasks from finished ones", () => {
  assert.deepEqual(notePaths("is:note budget").sort(), notePaths("budget").sort());
  assert.deepEqual(taskTexts("is:note budget"), []);
  assert.deepEqual(taskTexts("is:task budget"), ["Send the budget to accounts"]);
  assert.deepEqual(taskTexts("is:done path:meetings"), ["Book the room"]);
  assert.deepEqual(taskTexts("is:open path:meetings"), ["Send the budget to accounts"]);
});

test("a note is neither open nor done, so asking for either asks only about tasks", () => {
  assert.deepEqual(notePaths("is:open"), []);
  assert.deepEqual(notePaths("is:done"), []);
  assert.deepEqual(taskTexts("is:open").length, 1);
});

test("a task carries the tags of the note it lives in, where the reader put them", () => {
  assert.deepEqual(taskTexts("tag:finance"), ["Book the room", "Send the budget to accounts"]);
  assert.deepEqual(taskTexts("tag:finance is:open"), ["Send the budget to accounts"]);
});

test("a nested tag is matched by its parent, not only by its whole path", () => {
  const nested = buildSnapshot(
    [makeNote({ path: "n.md", content: "---\ntags: [project/atlas]\n---\n# N\nbudget\n" })],
    1,
    1,
  );

  assert.equal(buildWorkspaceSearchResults(nested, "tag:project").length, 1);
  assert.equal(buildWorkspaceSearchResults(nested, "tag:project/atlas").length, 1);
  assert.equal(buildWorkspaceSearchResults(nested, "tag:proj").length, 0);
});

test("the panel filter narrows by facet too, because it posts the query it was given", () => {
  const uris = matchingNoteUris(snapshot.notes, "path:meetings budget", 500);

  assert.deepEqual(uris, ["file:///meetings/q3-planning.md"]);
  assert.deepEqual(matchingNoteUris(snapshot.notes, "tag:finance", 500), [
    "file:///meetings/q3-planning.md",
  ]);
  assert.deepEqual(matchingNoteUris(snapshot.notes, "path:nowhere budget", 500), []);
  // A filter that names only tasks names no notes, and the panel lists notes.
  assert.deepEqual(matchingNoteUris(snapshot.notes, "is:task", 500), []);
});
