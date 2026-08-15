import assert = require("node:assert/strict");
import { test } from "node:test";
import {
  RECENT_ROW_LIMIT,
  buildNoteListing,
  emptyListingMessage,
  listingMeaning,
  listingTitle,
} from "../../src/application/noteListing";
import { formatNoteRecency } from "../../src/application/noteRecency";
import { buildSnapshot } from "../../src/indexing/projections";
import { makeNote } from "../indexing/fixtures";

/*
 * "The note I wrote last Tuesday" had no answer anywhere in this product: every list was
 * alphabetical. `modifiedAt` had been stat-ed for every note on every commit since the index
 * was written, and read by exactly one thing — the comparison that decides whether a note has
 * changed. This is the list it was always for.
 */

const NOW = Date.parse("2026-08-15T12:00:00Z");
const hoursAgo = (hours: number): number => NOW - hours * 60 * 60 * 1000;

function vault(...ages: readonly (readonly [string, number])[]) {
  return buildSnapshot(
    ages.map(([path, modifiedAt]) => makeNote({ path, modifiedAt })),
    1,
    1,
  );
}

test("the newest note leads the list, whatever it is called", () => {
  const snapshot = vault(
    ["aardvark.md", hoursAgo(200)],
    ["zebra.md", hoursAgo(1)],
    ["middle.md", hoursAgo(30)],
  );

  const rows = buildNoteListing(snapshot, { kind: "recent" });

  assert.deepEqual(rows.map((row) => row.path), ["zebra.md", "middle.md", "aardvark.md"]);
});

test("each row carries the moment it is ordered by, so the list can show it", () => {
  const snapshot = vault(["one.md", hoursAgo(3)]);

  assert.equal(buildNoteListing(snapshot, { kind: "recent" })[0]?.modifiedAt, hoursAgo(3));
});

/*
 * The question is about the last week or two of work, not the whole vault. A list long enough
 * to scroll would be a second, worse note list.
 */
test("the list stops at a length a reader can take in", () => {
  const notes = Array.from({ length: RECENT_ROW_LIMIT + 25 }, (_unused, at) =>
    ["note-" + String(at) + ".md", hoursAgo(at)] as const);

  assert.equal(buildNoteListing(vault(...notes), { kind: "recent" }).length, RECENT_ROW_LIMIT);
});

test("notes written in the same second still come out in one fixed order", () => {
  const snapshot = vault(["b.md", hoursAgo(5)], ["a.md", hoursAgo(5)]);

  assert.deepEqual(
    buildNoteListing(snapshot, { kind: "recent" }).map((row) => row.path),
    ["a.md", "b.md"],
  );
});

test("the list names itself the same way in every place that names it", () => {
  assert.equal(listingTitle({ kind: "recent" }), "Recent Notes");
  assert.match(emptyListingMessage({ kind: "recent" }), /note/i);
});

/*
 * BE HONEST. The row says "Recent Notes"; the order is the file's modification time, which is
 * a proxy for authorship and not a record of it. A bulk find-and-replace reorders the whole
 * view, and creation time cannot stand in — some file systems report a zero ctime, which is
 * why `createdAt` is left off a record rather than claimed as 1970.
 */
test("the list says which clock it is reading, and does not claim to know when you wrote it", () => {
  const meaning = listingMeaning({ kind: "recent" });

  assert.notEqual(meaning, undefined);
  assert.match(meaning ?? "", /last changed on disk/i);
  assert.match(meaning ?? "", /not the same as when you wrote it/i);
  assert.match(meaning ?? "", /find-and-replace/i);
});

test("the other lists have nothing to explain, so they say nothing", () => {
  assert.equal(listingMeaning({ kind: "orphans" }), undefined);
  assert.equal(listingMeaning({ kind: "broken" }), undefined);
  assert.equal(listingMeaning({ kind: "tag", tag: "project" }), undefined);
});

/*
 * The stamp is read against a list of notes a reader is trying to recognise, so it keeps the
 * words a reader would use and then gives up and shows the date — "43d ago" is not a day
 * anyone can place.
 */
test("how long ago reads the way a reader would say it", () => {
  assert.equal(formatNoteRecency(NOW - 20_000, NOW), "just now");
  assert.equal(formatNoteRecency(hoursAgo(0.5), NOW), "30m ago");
  assert.equal(formatNoteRecency(hoursAgo(3), NOW), "3h ago");
  assert.equal(formatNoteRecency(hoursAgo(30), NOW), "yesterday");
  assert.equal(formatNoteRecency(hoursAgo(24 * 4), NOW), "4d ago");
  assert.match(formatNoteRecency(hoursAgo(24 * 40), NOW), /\d/);
  assert.doesNotMatch(formatNoteRecency(hoursAgo(24 * 40), NOW), /ago/);
});

/* Late last night is yesterday at breakfast, not "8h ago". */
test("a note written last night reads as yesterday once the date has turned", () => {
  const lateLastNight = Date.parse("2026-08-14T23:30:00");
  const thisMorning = Date.parse("2026-08-15T07:30:00");

  assert.equal(formatNoteRecency(lateLastNight, thisMorning), "yesterday");
});

/* A file system that cannot say gets to say so, rather than reporting 1970. */
test("a moment the file system never gave is not dressed up as one", () => {
  assert.equal(formatNoteRecency(0, NOW), "date unknown");
});
