import assert = require("node:assert/strict");
import { test } from "node:test";
import type { IndexSnapshot, NoteTask } from "../../src/domain/models";
import { bucketFor, selectDueTasks } from "../../src/application/dueTasks";

const TODAY = "2026-08-15";

function snapshot(tasks: readonly Partial<NoteTask>[]): IndexSnapshot {
  return {
    notes: [], links: [], backlinks: [], version: 1, indexedAt: 0,
    tasks: tasks.map((task, index) => ({
      text: task.text ?? `Task ${index}`,
      completed: task.completed ?? false,
      ...(task.due === undefined ? {} : { due: task.due }),
      tags: [],
      range: { start: index * 10, end: index * 10 + 5 },
      checkboxRange: { start: index * 10 + 2, end: index * 10 + 3 },
      line: index,
      noteUri: "file:///notes/a.md",
      noteTitle: "A",
      notePath: "notes/a.md",
    })),
  };
}

const textsOf = (tasks: readonly { readonly text: string }[]): readonly string[] =>
  tasks.map((task) => task.text);

test("a due date lands in the bucket it belongs to", () => {
  assert.equal(bucketFor("2026-08-14", TODAY), "overdue");
  assert.equal(bucketFor("2026-08-15", TODAY), "today");
  assert.equal(bucketFor("2026-08-15 23:59", TODAY), "today", "a time of day does not move it");
  assert.equal(bucketFor("2026-08-16", TODAY), "upcoming");
  assert.equal(bucketFor(undefined, TODAY), "undated");
  assert.equal(bucketFor("next friday", TODAY), "undated", "unreadable is not a date");
});

/*
 * The complaint this answers: scoped strictly to the current date, a task that slipped its day
 * left the list, so the row meant to say what was owed went quiet exactly when something had
 * been forgotten.
 */
test("late work is today's work, and the oldest slip comes first", () => {
  const due = selectDueTasks(
    snapshot([
      { text: "Today", due: "2026-08-15" },
      { text: "Slipped a month", due: "2026-07-15" },
      { text: "Slipped a day", due: "2026-08-14" },
    ]),
    TODAY,
  );

  assert.deepEqual(textsOf(due.rows), ["Slipped a month", "Slipped a day", "Today"]);
  assert.equal(due.overdue, 2);
});

/*
 * Deliberately narrower than All Tasks. Carrying next month's work and the undated as well
 * would make this the backlog again under a second name.
 */
test("work that is neither late nor due today stays out", () => {
  const due = selectDueTasks(
    snapshot([
      { text: "Tomorrow", due: "2026-08-16" },
      { text: "Next month", due: "2026-09-15" },
      { text: "No date at all" },
      { text: "Today", due: "2026-08-15" },
    ]),
    TODAY,
  );
  assert.deepEqual(textsOf(due.rows), ["Today"]);
  assert.equal(due.total, 1);
});

test("within a day the time of day orders them", () => {
  const due = selectDueTasks(
    snapshot([
      { text: "Evening", due: "2026-08-15 18:00" },
      { text: "Morning", due: "2026-08-15 09:00" },
    ]),
    TODAY,
  );
  assert.deepEqual(textsOf(due.rows), ["Morning", "Evening"]);
});

test("finished work is not pending", () => {
  const due = selectDueTasks(
    snapshot([
      { text: "Done", due: "2026-08-14", completed: true },
      { text: "Not done", due: "2026-08-14" },
    ]),
    TODAY,
  );
  assert.deepEqual(textsOf(due.rows), ["Not done"]);
  assert.equal(due.total, 1);
});

test("the count describes everything owed, even when the list is capped", () => {
  const many = Array.from({ length: 120 }, (_, index) => ({
    text: `Task ${String(index).padStart(3, "0")}`,
    due: index < 90 ? "2026-08-14" : "2026-08-15",
  }));
  const due = selectDueTasks(snapshot(many), TODAY, 50);

  assert.equal(due.rows.length, 50, "only what the panel will draw");
  assert.equal(due.total, 120, "but the count is everything late or due today");
  assert.equal(due.overdue, 90);
  assert.equal(due.rows[0]?.text, "Task 000", "the cap keeps the late ones, not an arbitrary 50");
  assert.equal(due.rows.every((task) => task.bucket === "overdue"), true);
});

test("an empty workspace is simply empty", () => {
  const due = selectDueTasks(snapshot([]), TODAY);
  assert.deepEqual(due.rows, []);
  assert.equal(due.total, 0);
  assert.equal(due.overdue, 0);
});
