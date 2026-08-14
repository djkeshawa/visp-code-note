import assert = require("node:assert/strict");
import { test } from "node:test";
// Must come first: it draws the view's markup and installs the host stub it loads into.
import "../support/tasksPanelDom";
import "../../src/webview/tasks";
import {
  focused,
  listTabStops,
  posted,
  press,
  publish,
  rows,
  search,
  type,
} from "../support/tasksPanelDom";
import type { TasksState } from "../../src/domain/protocol";

/*
 * A task row spends two controls — the checkbox and the way into the note — so the fortieth
 * task in this view used to be eighty Tab presses down a list that is rebuilt every time the
 * index moves.
 */

function task(text: string, start: number): TasksState["tasks"][number] {
  return {
    text,
    completed: false,
    tags: [],
    range: { start, end: start + 20 },
    checkboxRange: { start, end: start + 3 },
    line: 1,
    noteUri: "file:///vault/inbox.md",
    noteTitle: "Inbox",
    notePath: "inbox.md",
  };
}

function snapshot(): TasksState {
  return {
    tasks: [task("Ring the plumber", 0), task("Book the van", 40), task("File the receipts", 80)],
    reminders: [],
    reminderCount: 0,
    version: 1,
    indexedAt: 1,
    filter: "all",
  };
}

function open(): void {
  type("");
  publish(snapshot());
  search().focus();
  posted.length = 0;
}

test("the whole list is one tab stop, not two per task", () => {
  open();

  assert.equal(rows().length, 3);
  assert.equal(listTabStops().length, 2, "one row's checkbox and its way in, and nothing else");
});

/* The view sorts its rows, so the top of the list is not the order the host sent. */
test("ArrowDown from the filter steps into the list", () => {
  open();
  press(search(), "ArrowDown");

  assert.equal(focused()?.getAttribute("aria-label"), "Complete Book the van");
});

/*
 * Working down a list of checkboxes has to stay in the checkbox column, or completing a run of
 * tasks becomes a Tab dance every second row.
 */
test("the arrows keep to the column they started in", () => {
  open();
  const opener = rows()[0]?.querySelector<HTMLElement>('button[data-action="open"]');
  opener?.focus();
  press(opener as HTMLElement, "ArrowDown");

  assert.equal(focused()?.textContent, "File the receipts");
});

test("filtering to one task and pressing Enter opens it", () => {
  open();
  type("receipts");
  press(search(), "Enter");

  assert.deepEqual(posted, [
    { type: "tasks/open", noteUri: "file:///vault/inbox.md", start: 80 },
  ]);
  type("");
});

test("the index republishing does not drop focus out of the list", () => {
  open();
  rows()[1]?.querySelector<HTMLElement>('button[data-action="open"]')?.focus();

  publish(snapshot());

  assert.notEqual(focused(), undefined, "focus fell to the body when the list was rebuilt");
  assert.equal(focused()?.textContent, "File the receipts");
});
