import assert = require("node:assert/strict");
import { test } from "node:test";
// Must come first: it draws the panel's markup and installs the host stub the panel loads into.
import "../support/freshWorkspacePanel";
import "../../src/webview/workspace";
import {
  element,
  focused,
  focusedText,
  posted,
  press,
  publish,
  tabStops,
  typeFilter,
} from "../support/workspacePanelDom";
import { panelState } from "../support/workspacePanelState";

/*
 * You type into the filter, sixty rows narrow to three, and then there is nothing you can do
 * with them without a mouse: the field's only key was Escape, and every row was its own tab
 * stop, so row 40 of a filtered list was 40 Tab presses away through a list that redraws
 * between presses.
 *
 * Every assertion here is about where focus actually is after an action, because that is the
 * thing the reader finds out and the thing watching the list change cannot tell you.
 */

const VAULT = [
  "journal/monday.md",
  "journal/tuesday.md",
  "journal/wednesday.md",
  "inbox.md",
];

const DUE = [
  {
    noteUri: "file:///vault/inbox.md",
    noteTitle: "Inbox",
    start: 10,
    text: "Ring the plumber",
    completed: false,
  },
];

function filter(): HTMLInputElement {
  return element<HTMLInputElement>("#workspace-filter");
}

function noteRows(): readonly HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>("#workspace-notes .workspace-row"));
}

async function vault(overrides = {}): Promise<void> {
  await typeFilter("");
  publish(panelState(VAULT, overrides));
  const open = document.querySelector<HTMLElement>(
    '#workspace-notes .workspace-row[aria-expanded="true"]',
  );
  open?.click();
  filter().focus();
  posted.length = 0;
}

test("a list of notes is one tab stop, not one per note", async () => {
  await vault();
  (noteRows()[0] as HTMLElement).click();
  const stops = tabStops().filter((stop) => stop.closest("#workspace-notes") !== null);

  assert.equal(noteRows().length, 5, "the folder did not open, so this proves nothing");
  assert.equal(stops.length, 1);
});

test("ArrowDown from the filter lands on a row rather than doing nothing", async () => {
  await vault();
  press(filter(), "ArrowDown");

  assert.equal(focusedText(), "Due Today0");
});

test("the arrows walk the list, and Home and End reach its ends", async () => {
  await vault();
  const rows = noteRows();
  rows[0]?.focus();

  press(rows[0] as HTMLElement, "ArrowDown");
  assert.equal(focused(), rows[1]);
  press(rows[1] as HTMLElement, "End");
  assert.equal(focused(), rows.at(-1));
  press(rows.at(-1) as HTMLElement, "Home");
  assert.equal(focused(), rows[0]);
  // The end of the list holds rather than wrapping back to the top.
  press(rows[0] as HTMLElement, "ArrowUp");
  assert.equal(focused(), rows[0]);
});

test("Enter in the filter opens the row the reader can see at the top", async () => {
  await vault();
  await typeFilter("tuesday");
  filter().focus();
  press(filter(), "Enter");

  assert.deepEqual(posted.filter((message) => isOpenNote(message)), [
    { type: "workspace/openNote", uri: "file:///vault/journal/tuesday.md" },
  ]);
  await typeFilter("");
});

/*
 * The field is debounced, so Enter pressed straight after the last character used to open
 * whatever the *previous* query had left at the top of the list.
 */
test("Enter opens what the field says now, not what it said a moment ago", async () => {
  await vault();
  await typeFilter("monday");
  posted.length = 0;

  const box = filter();
  box.value = "wednesday";
  box.dispatchEvent(new window.Event("input"));
  box.focus();
  press(box, "Enter");

  assert.deepEqual(posted.filter((message) => isOpenNote(message)), [
    { type: "workspace/openNote", uri: "file:///vault/journal/wednesday.md" },
  ]);
  await typeFilter("");
});

/*
 * FOCUS SURVIVAL. Every view here re-renders by replacing its rows, so an action taken from
 * the keyboard destroys the element the reader was standing on and focus falls to the body —
 * and the next Tab restarts at the top of the window.
 */
test("expanding a folder from the keyboard leaves focus on the folder, not on the body", async () => {
  await vault();
  const folder = noteRows()[0] as HTMLElement;
  folder.focus();
  press(folder, "ArrowRight");

  assert.equal(focusedText(), "journal3");
  assert.equal(focused()?.getAttribute("aria-expanded"), "true");
});

test("the index republishing under a reader does not take focus away from the list", async () => {
  await vault();
  const row = noteRows()[1] as HTMLElement;
  row.focus();
  const label = focusedText();

  publish(panelState(VAULT));

  assert.notEqual(focused(), undefined, "focus fell to the body when the index republished");
  assert.equal(focusedText(), label);
});

test("a reader who has moved to the filter is not dragged back into the list", async () => {
  await vault();
  (noteRows()[1] as HTMLElement).focus();
  filter().focus();

  publish(panelState(VAULT));

  assert.equal(focused(), filter());
});

/* A task's note was reachable only by clicking the text, which was a span and so not focusable. */
test("the note behind a due task can be opened without a pointer", async () => {
  await vault({ dueToday: DUE });
  const text = element<HTMLElement>("#workspace-views .workspace-task-text");
  text.focus();
  text.click();

  assert.deepEqual(posted.filter((message) => isRevealTask(message)), [
    { type: "workspace/revealTask", noteUri: "file:///vault/inbox.md", start: 10 },
  ]);
});

test("arrowing down the Views section keeps to the column it started in", async () => {
  await vault({ dueToday: DUE });
  const rows = Array.from(document.querySelectorAll<HTMLElement>(
    "#workspace-views .workspace-row, #workspace-views .workspace-task",
  ));
  const due = rows[0] as HTMLElement;
  due.focus();
  press(due, "ArrowDown");

  // The task row's first control is its checkbox, which is where a reader arriving lands.
  assert.equal(focusedText(), "Complete Ring the plumber");
});

function isOpenNote(message: unknown): boolean {
  return typeof message === "object" && message !== null &&
    (message as { type?: unknown }).type === "workspace/openNote";
}

function isRevealTask(message: unknown): boolean {
  return typeof message === "object" && message !== null &&
    (message as { type?: unknown }).type === "workspace/revealTask";
}
