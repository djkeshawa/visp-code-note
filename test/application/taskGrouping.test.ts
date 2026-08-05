import assert = require("node:assert/strict");
import { test } from "node:test";
import type { TaskWire } from "../../src/webview/contracts";
import { groupTasks } from "../../src/webview/tasks/grouping";

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

/*
 * Due Today carries work that slipped as well as work landing now. Scoped strictly to the
 * current date, a task that missed its day left the list, and the view went quiet exactly when
 * something had been forgotten.
 */
test("the today view holds what is late as well as what lands today", () => {
  const tasks: readonly TaskWire[] = [
    { ...baseTask, text: "Due today", due: "2026-07-22" },
    { ...baseTask, text: "Completed today", due: "2026-07-22", completed: true },
    { ...baseTask, text: "Due tomorrow", due: "2026-07-23" },
    { ...baseTask, text: "Timed today", due: "2026-07-22T18:00:00" },
    { ...baseTask, text: "Slipped last week", due: "2026-07-15" },
    { ...baseTask, text: "No date at all" },
  ];

  const groups = groupTasks(tasks, { query: "", status: "all", view: "today" }, "2026-07-22");

  assert.deepEqual(groups.map((group) => group.name), ["Overdue", "Today"]);
  assert.deepEqual(
    groups.flatMap((group) => group.tasks.map((task) => task.text)),
    ["Slipped last week", "Due today", "Timed today"],
    "late first; tomorrow, the undated and the completed one all stay out",
  );
});

test("a due with a time of day still buckets and sorts by its date", () => {
  const tasks: readonly TaskWire[] = [
    { ...baseTask, text: "Later today", due: "2026-07-22 18:00" },
    { ...baseTask, text: "Earlier today", due: "2026-07-22 09:00" },
    { ...baseTask, text: "Overdue", due: "2026-07-21 23:59" },
  ];

  const groups = groupTasks(tasks, { query: "", status: "all", view: "all" }, "2026-07-22");

  assert.deepEqual(groups.map((group) => group.name), ["Overdue", "Today"]);
  assert.deepEqual(
    groups[1]?.tasks.map((task) => task.text),
    ["Earlier today", "Later today"],
    "within a day the time orders them",
  );
});

test("a descending due sort reverses the dated tasks but never surfaces the undated", () => {
  const tasks: readonly TaskWire[] = [
    { ...baseTask, text: "No date" },
    { ...baseTask, text: "Sooner", due: "2026-07-23" },
    { ...baseTask, text: "Later", due: "2026-07-30" },
  ];

  const groups = groupTasks(
    tasks,
    { query: "", status: "all", view: "all", groupBy: "note", sortBy: "due", direction: "desc" },
    "2026-07-22",
  );

  assert.deepEqual(
    groups[0]?.tasks.map((task) => task.text),
    ["Later", "Sooner", "No date"],
    "the far date leads, and a task with no date stays at the end either way",
  );
});

test("sorting by note created date orders tasks by the note's age", () => {
  const tasks: readonly TaskWire[] = [
    { ...baseTask, text: "From the new note", noteCreatedAt: 3_000 },
    { ...baseTask, text: "From the old note", noteCreatedAt: 1_000 },
    { ...baseTask, text: "From a note with no birth date" },
  ];
  const filter = {
    query: "",
    status: "all",
    view: "all",
    groupBy: "note",
    sortBy: "created",
  } as const;

  const ascending = groupTasks(tasks, filter, "2026-07-22");
  assert.deepEqual(
    ascending[0]?.tasks.map((task) => task.text),
    ["From the old note", "From the new note", "From a note with no birth date"],
    "oldest note first; a note the file system cannot date sits at the end",
  );

  const descending = groupTasks(tasks, { ...filter, direction: "desc" }, "2026-07-22");
  assert.deepEqual(
    descending[0]?.tasks.map((task) => task.text),
    ["From the new note", "From the old note", "From a note with no birth date"],
    "newest note first, and the undatable note still stays at the end",
  );
});

test("a completed task sinks below open ones whatever the sort says", () => {
  const tasks: readonly TaskWire[] = [
    { ...baseTask, text: "Alpha done", completed: true },
    { ...baseTask, text: "Zulu open" },
  ];

  const groups = groupTasks(
    tasks,
    { query: "", status: "all", view: "all", groupBy: "note", sortBy: "text", direction: "asc" },
    "2026-07-22",
  );

  assert.deepEqual(
    groups[0]?.tasks.map((task) => task.text),
    ["Zulu open", "Alpha done"],
    "alphabetical order applies within the open tasks, not across the done divide",
  );
});
