import assert = require("node:assert/strict");
import { test } from "node:test";
// Must come first: it draws the list's markup and installs the host stub it loads into.
import "../support/notesPanelDom";
import "../../src/webview/notes";
import {
  focused,
  listTabStops,
  posted,
  press,
  publish,
  rows,
  search,
  type,
} from "../support/notesPanelDom";
import type { NoteListRow, NotesState } from "../../src/domain/protocol";

/*
 * Working through a list of broken links is what this panel is for, and until now it could
 * only be done with a mouse: every row was its own tab stop, and the list is rebuilt whenever
 * the index moves.
 */

const ROWS: readonly NoteListRow[] = [
  { uri: "file:///vault/a.md", title: "Alpha", path: "notes/a.md" },
  { uri: "file:///vault/b.md", title: "Beta", path: "notes/b.md" },
  { uri: "file:///vault/c.md", title: "Gamma", path: "notes/c.md" },
];

function orphans(): NotesState {
  return { listing: { kind: "orphans" }, rows: ROWS, indexedAt: 1 };
}

function open(): void {
  type("");
  publish(orphans());
  search().focus();
  posted.length = 0;
}

test("the whole list is one tab stop, not one per row", () => {
  open();

  assert.equal(rows().length, 3);
  assert.equal(listTabStops().length, 1);
});

test("ArrowDown from the filter steps into the list", () => {
  open();
  press(search(), "ArrowDown");

  assert.equal(focused(), rows()[0]);
});

test("the arrows walk the rows and the ends hold", () => {
  open();
  rows()[0]?.focus();

  press(rows()[0] as HTMLElement, "ArrowDown");
  assert.equal(focused(), rows()[1]);
  press(rows()[1] as HTMLElement, "End");
  assert.equal(focused(), rows()[2]);
  press(rows()[2] as HTMLElement, "ArrowDown");
  assert.equal(focused(), rows()[2]);
});

test("filtering to one row and pressing Enter opens it", () => {
  open();
  type("gamma");
  press(search(), "Enter");

  assert.deepEqual(posted, [{ type: "notes/open", uri: "file:///vault/c.md" }]);
  type("");
});

/* The list is replaced wholesale whenever the index moves, which used to lose the reader. */
test("the index republishing does not drop focus out of the list", () => {
  open();
  rows()[1]?.focus();

  publish(orphans());

  assert.notEqual(focused(), undefined, "focus fell to the body when the list was rebuilt");
  assert.equal(focused(), rows()[1]);
});
