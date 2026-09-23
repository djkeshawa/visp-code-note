import assert = require("node:assert/strict");
import { test } from "node:test";
import { publish, rows, search, type, restoreState, savedState } from "../support/tasksPanelDom";
import { window } from "../support/domEnvironment";
import type { TasksState } from "../../src/domain/protocol";

restoreState({ query: "review", groupBy: "note", sortBy: "text", direction: "desc", status: "all" });
require("../../src/webview/tasks");

const state: TasksState = {
  tasks: [false, true].map((completed, index) => ({
    text: `Review ${index}`, completed, tags: [], due: "2020-01-01", noteUri: "file:///a.md",
    noteTitle: "Alpha", notePath: "a.md", line: index + 1,
    range: { start: index * 20, end: index * 20 + 19 },
    checkboxRange: { start: index * 20, end: index * 20 + 3 },
  })),
  reminders: [], reminderCount: 0, version: 1, indexedAt: 1, filter: "all",
};

test("task controls restore from webview state", () => {
  publish(state);
  assert.equal(search().value, "review");
  assert.equal(rows().length, 2);
  assert.equal(window.document.querySelector<HTMLSelectElement>("#task-group-by")?.value, "note");
  assert.equal(window.document.querySelector<HTMLSelectElement>("#task-sort-by")?.value, "text");
  assert.equal(window.document.querySelector("#task-sort-direction")?.getAttribute("aria-pressed"), "true");
});

test("Due Today forces open tasks without erasing the preferred status", () => {
  publish({ ...state, filter: "today" });
  assert.equal(rows().length, 1);
  assert.equal(window.document.querySelector<HTMLButtonElement>('[data-status="open"]')?.disabled, true);
  assert.equal(window.document.querySelector('[data-status="open"]')?.getAttribute("aria-pressed"), "true");
  publish(state);
  assert.equal(rows().length, 2);
  assert.equal(window.document.querySelector('[data-status="all"]')?.getAttribute("aria-pressed"), "true");
  assert.deepEqual(savedState, { query: "review", groupBy: "note", sortBy: "text", direction: "desc", status: "all" });
});

test("an empty task search can be cleared without changing grouping or status", () => {
  type("no task matches");
  assert.equal(rows().length, 0);
  const reset = window.document.querySelector<HTMLButtonElement>(".empty-state-action");
  assert.ok(reset);
  reset.click();
  assert.equal(rows().length, 2);
  assert.equal(window.document.activeElement, search());
  assert.equal(window.document.querySelector<HTMLSelectElement>("#task-group-by")?.value, "note");
});
