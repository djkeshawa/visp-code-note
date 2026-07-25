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

test("today view includes only incomplete tasks due on the local date", () => {
  const tasks: readonly TaskWire[] = [
    { ...baseTask, text: "Due today", due: "2026-07-22" },
    { ...baseTask, text: "Completed today", due: "2026-07-22", completed: true },
    { ...baseTask, text: "Due tomorrow", due: "2026-07-23" },
    { ...baseTask, text: "Timed today", due: "2026-07-22T18:00:00" },
  ];

  const groups = groupTasks(tasks, { query: "", status: "all", view: "today" }, "2026-07-22");

  assert.deepEqual(groups.map((group) => group.name), ["Today"]);
  assert.deepEqual(groups[0]?.tasks.map((task) => task.text), ["Due today", "Timed today"]);
});
