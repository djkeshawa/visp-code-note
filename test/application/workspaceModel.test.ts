import assert = require("node:assert/strict");
import { test } from "node:test";
import { buildSnapshot } from "../../src/indexing/projections";
import { formatIndexedAt } from "../../src/application/indexFreshness";
import { noteLinkCounts, todayStamp } from "../../src/vscode/providers/explorerModel";
import { makeNote } from "../indexing/fixtures";

/*
 * What the workspace panel asks of the index. The panel replaced a tree view, and with it the
 * row-shaping this file used to cover; what remains is the two questions the panel asks that
 * are not simply "list the notes".
 */

test("today's stamp is a sortable ISO date", () => {
  assert.equal(todayStamp(new Date(2026, 6, 4)), "2026-07-04");
  assert.match(todayStamp(), /^\d{4}-\d{2}-\d{2}$/);
});

/*
 * The panel reports how connected each note is. Both ends of a resolved link count, because
 * "connected" is a property of the pair, and an unresolved link connects nothing yet.
 */
test("link counts are neighbours, so linking the same note twice is one connection", () => {
  const hub = makeNote({
    path: "notes/hub.md",
    content: "# Hub\n\nSee [[Spoke]] and [[Spoke]] again, plus [[Nowhere]].\n",
  });
  const spoke = makeNote({ path: "notes/spoke.md", content: "# Spoke\n" });

  const counts = noteLinkCounts(buildSnapshot([hub, spoke]));

  assert.equal(counts.get(hub.uri), 1);
  assert.equal(counts.get(spoke.uri), 1);
});

/*
 * An in-note anchor resolves to the note itself. Counting those rows made a note that links
 * to nothing outside itself display as the best-connected note in the workspace.
 */
test("a note linking only to itself is connected to nothing", () => {
  const inward = makeNote({
    path: "notes/inward.md",
    content: "# Inward\n\n## A\n\n## B\n\nSee [[#A]] and [[#B]] and [[Inward]].\n",
  });

  assert.equal(noteLinkCounts(buildSnapshot([inward])).get(inward.uri), undefined);
});

test("a note nothing links to is absent from the link counts", () => {
  const lonely = makeNote({ path: "notes/lonely.md", content: "# Lonely\n" });

  assert.equal(noteLinkCounts(buildSnapshot([lonely])).get(lonely.uri), undefined);
});

test("index freshness reads in the coarsest unit that still says something", () => {
  const now = Date.parse("2026-07-26T12:00:00Z");
  const ago = (seconds: number): number => now - seconds * 1000;

  assert.equal(formatIndexedAt(ago(5), now), "indexed just now");
  assert.equal(formatIndexedAt(ago(120), now), "indexed 2m ago");
  assert.equal(formatIndexedAt(ago(3 * 3600), now), "indexed 3h ago");
  assert.equal(formatIndexedAt(ago(50 * 3600), now), "indexed 2d ago");
});

test("an index that has never been built reports no time at all", () => {
  assert.equal(formatIndexedAt(0), undefined);
});
