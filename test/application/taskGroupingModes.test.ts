import assert = require("node:assert/strict");
import { test } from "node:test";
import type { TaskWire } from "../../src/webview/contracts";
import { groupTasks, parseTaskGrouping } from "../../src/webview/tasks/grouping";

const baseTask: TaskWire = {
  text: "Review release",
  completed: false,
  tags: [],
  range: { start: 0, end: 10 },
  checkboxRange: { start: 3, end: 4 },
  line: 0,
  noteUri: "file:///notes/release.md",
  noteTitle: "Release",
  notePath: "notes/release.md",
};

const tasks: readonly TaskWire[] = [
  { ...baseTask, text: "Ship it", noteTitle: "Release", tags: ["product"], due: "2026-07-22" },
  { ...baseTask, text: "Draft notes", noteTitle: "Atlas", tags: ["product", "docs"] },
  { ...baseTask, text: "Untagged chore", noteTitle: "Atlas" },
  { ...baseTask, text: "Archive", noteTitle: "Backlog", completed: true },
];

const filter = { query: "", status: "all", view: "all" } as const;

function shape(groupBy: "due" | "note" | "tag"): Record<string, readonly string[]> {
  return Object.fromEntries(
    groupTasks(tasks, { ...filter, groupBy }, "2026-07-22")
      .map((group) => [group.name, group.tasks.map((task) => task.text)]),
  );
}

test("grouping by note sorts note names alphabetically", () => {
  const groups = groupTasks(tasks, { ...filter, groupBy: "note" }, "2026-07-22");

  assert.deepEqual(groups.map((group) => group.name), ["Atlas", "Backlog", "Release"]);
  assert.deepEqual(shape("note").Atlas, ["Draft notes", "Untagged chore"]);
});

test("a task with several tags appears under each, and untagged work goes last", () => {
  const groups = groupTasks(tasks, { ...filter, groupBy: "tag" }, "2026-07-22");

  assert.deepEqual(groups.map((group) => group.name), ["#docs", "#product", "No tag"]);
  assert.deepEqual(shape("tag")["#product"], ["Ship it", "Draft notes"]);
  assert.deepEqual(shape("tag")["No tag"], ["Untagged chore", "Archive"]);
});

test("due-date grouping stays the default and keeps its fixed bucket order", () => {
  assert.deepEqual(
    Object.keys(shape("due")),
    ["Today", "No due date", "Completed"],
  );
  assert.deepEqual(
    groupTasks(tasks, filter, "2026-07-22").map((group) => group.name),
    Object.keys(shape("due")),
  );
});

test("completed work sorts after open work inside a group", () => {
  assert.deepEqual(shape("note").Backlog, ["Archive"]);
  assert.deepEqual(shape("tag")["No tag"], ["Untagged chore", "Archive"]);
});

test("an unknown grouping falls back to due dates", () => {
  assert.equal(parseTaskGrouping("note"), "note");
  assert.equal(parseTaskGrouping("project"), "due");
  assert.equal(parseTaskGrouping(undefined), "due");
});
