import assert = require("node:assert/strict");
import { test } from "node:test";
// Must come first: it draws the list's markup and installs the host stub it loads into.
import "../support/notesPanelDom";
import "../../src/webview/notes";
import { publish, rows, text } from "../support/notesPanelDom";
import { buildNoteListing } from "../../src/application/noteListing";
import { buildSnapshot } from "../../src/indexing/projections";
import { makeNote } from "../indexing/fixtures";

/*
 * The seam a new listing kind fails at, quietly.
 *
 * `NoteListing` is a discriminated union with a host builder, a wire type and a webview
 * validator. A kind the validator does not name is not refused loudly — it is dropped, the
 * panel's state stays undefined, the view goes on saying "Building the index…", and nothing
 * anywhere reports a fault. So the check is not that the validator compiles: it is that a real
 * recent listing, built by the host, draws rows in the real panel.
 */

const NOW = Date.now();

function recentState() {
  const snapshot = buildSnapshot([
    makeNote({ path: "old.md", modifiedAt: NOW - 40 * 24 * 60 * 60 * 1000 }),
    makeNote({ path: "fresh.md", modifiedAt: NOW - 60 * 1000 }),
  ], 1, 1);
  return {
    listing: { kind: "recent" } as const,
    rows: buildNoteListing(snapshot, { kind: "recent" }),
    indexedAt: NOW,
  };
}

test("a recent listing reaches the panel and draws its rows", () => {
  publish(recentState());

  assert.equal(rows().length, 2, "the validator dropped the listing, so the view showed nothing");
  assert.equal(text("#note-view-title"), "Recent Notes");
});

test("the newest note is at the top, and every row says how long ago", () => {
  publish(recentState());
  const drawn = rows().map((row) => row.querySelector(".note-row-title")?.textContent);

  assert.deepEqual(drawn, ["fresh", "old"]);
  const stamps = rows().map((row) => row.querySelector(".note-row-when")?.textContent);
  assert.equal(stamps[0], "1m ago");
  assert.notEqual(stamps[1], undefined);
});

/*
 * The list is called "Recent Notes" and is ordered by when each file was last written, which
 * is not the same thing. It says so on the list, not in a tooltip: a reader who misreads this
 * list has no reason to hover anything.
 */
test("the list admits, in the window, which clock it is reading", () => {
  publish(recentState());

  const summary = text("#note-summary");
  assert.match(summary, /last changed on disk/i);
  assert.match(summary, /not the same as when you wrote it/i);
});

test("a list that is not about time carries no stamps at all", () => {
  publish({
    listing: { kind: "orphans" },
    rows: [{ uri: "file:///vault/a.md", title: "Alpha", path: "a.md" }],
    indexedAt: NOW,
  });

  assert.equal(rows()[0]?.querySelector(".note-row-when"), null);
  assert.doesNotMatch(text("#note-summary"), /disk/i);
});
