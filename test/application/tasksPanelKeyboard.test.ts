import assert = require("node:assert/strict");
import { afterEach, test } from "node:test";
import { setWebviewFocused } from "../support/webviewFocus";
afterEach(() => setWebviewFocused(true));
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
import { window } from "../support/domEnvironment";

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

function withReminder(): TasksState {
  return {
    ...snapshot(),
    reminders: [{
      text: "Ring the plumber",
      noteUri: "file:///vault/inbox.md",
      noteTitle: "Inbox",
      start: 0,
      at: Date.now(),
      dueAt: Date.now(),
    }],
    reminderCount: 1,
  };
}

test("Enter from a filtered task search skips unrelated pinned reminders", () => {
  open();
  publish(withReminder());
  type("receipts");
  press(search(), "Enter");

  assert.deepEqual(posted, [
    { type: "tasks/open", noteUri: "file:///vault/inbox.md", start: 80 },
  ]);
});

test("Enter with no matching tasks does not open a pinned reminder", () => {
  open();
  publish(withReminder());
  type("no matching task");
  press(search(), "Enter");

  assert.deepEqual(posted, []);
});

test("ArrowDown from a filtered task search focuses a matching task", () => {
  open();
  publish(withReminder());
  type("receipts");
  press(search(), "ArrowDown");

  assert.equal(focused()?.getAttribute("aria-label"), "Complete File the receipts");
});

test("a toggle response does not steal focus after the reader moves to search", () => {
  open();
  const checkbox = rows()[0]?.querySelector<HTMLInputElement>('input[data-action="toggle"]');
  assert.ok(checkbox);
  checkbox.focus();
  checkbox.click();
  search().focus();
  publish(snapshot());

  assert.equal(focused(), search());
});

test("completing a task keeps keyboard focus on the next remaining task", () => {
  open();
  const checkbox = rows()[0]?.querySelector<HTMLInputElement>('input[data-action="toggle"]');
  assert.ok(checkbox);
  checkbox.focus();
  checkbox.click();
  publish({ ...snapshot(), tasks: snapshot().tasks.map((item) =>
    item.range.start === 40 ? { ...item, completed: true } : item) });

  assert.equal(focused()?.getAttribute("aria-label"), "Complete File the receipts");
});

test("a filtered list does not claim that hidden future tasks are unscheduled", () => {
  open();
  publish({ ...snapshot(), tasks: [...snapshot().tasks, {
    ...task("Future work", 120), due: "2099-01-01",
  }] });
  type("receipts");

  assert.equal(window.document.querySelector(".empty-state-message"), null);
});

test("an empty workspace explains how to add a task", () => {
  open();
  publish({ ...snapshot(), tasks: [] });

  assert.match(window.document.querySelector(".empty-state-message")?.textContent ?? "", /No tasks yet/);
  assert.match(window.document.querySelector(".empty-state-hint")?.textContent ?? "", /checkbox/i);
});


test("a task update after leaving the pane cannot reclaim its checkbox", () => {
  open();
  const checkbox = rows()[0]!.querySelector<HTMLInputElement>('input[data-action="toggle"]')!;
  checkbox.focus();
  checkbox.click();
  setWebviewFocused(false);
  publish(snapshot());
  assert.equal(focused(), undefined, "the task pane stole focus from another editor");
});
