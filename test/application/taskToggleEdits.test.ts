import assert = require("node:assert/strict");
import { test } from "node:test";
import { planTaskToggle } from "../../src/application/taskEditing";
import { parseMarkdown } from "../../src/markdown/parser";

const NOTE = [
  "# Open work",
  "",
  "- [ ] Draft the section on spaced repetition @due(2026-08-03)",
  "- [x] Move the archive out of ~/Documents",
  "",
].join("\n");

const taskAt = (source: string, line: number) => {
  const task = parseMarkdown(source).tasks.find((candidate) => candidate.line === line);
  assert.ok(task, `expected a task on line ${line}`);
  return task;
};

const applied = (source: string, plan: { start: number; end: number; text: string }): string =>
  source.slice(0, plan.start) + plan.text + source.slice(plan.end);

test("completing a task writes an x into its checkbox and nothing else", () => {
  const plan = planTaskToggle(NOTE, taskAt(NOTE, 2));

  assert.ok(plan);
  assert.equal(NOTE.slice(plan.start, plan.end), " ");
  assert.equal(plan.text, "x");
  assert.ok(applied(NOTE, plan).includes("- [x] Draft the section"));
});

test("reopening a completed task clears its checkbox", () => {
  const plan = planTaskToggle(NOTE, taskAt(NOTE, 3));

  assert.ok(plan);
  assert.equal(plan.text, " ");
  assert.ok(applied(NOTE, plan).includes("- [ ] Move the archive"));
});

/*
 * The task the caller holds came from a list drawn against an older snapshot, so its offsets
 * may already have moved — typing anywhere above it is enough. They are re-read from the live
 * text; using the stale ones would put the `x` into the middle of a sentence.
 */
test("offsets are re-read from the live text, not taken from the stale task", () => {
  const stale = taskAt(NOTE, 2);
  const edited = NOTE.replace("# Open work", "# Open work, and rather more of it than before");

  const plan = planTaskToggle(edited, stale);

  assert.ok(plan);
  assert.notEqual(plan.start, stale.checkboxRange.start);
  assert.equal(edited.slice(plan.start, plan.end), " ");
  assert.ok(applied(edited, plan).includes("- [x] Draft the section"));
});

/*
 * Matched on the line and the text together. Text alone would flip whichever "Review" the
 * parser happened to return first in a note that has several; a line alone would flip
 * whatever has since taken that line's place.
 */
test("a line that now holds a different task is refused rather than flipped", () => {
  const stale = taskAt(NOTE, 2);
  const rewritten = NOTE.replace("Draft the section on spaced repetition", "Something else");

  assert.equal(planTaskToggle(rewritten, stale), undefined);
});

test("a task that has moved to another line is refused rather than guessed at", () => {
  const stale = taskAt(NOTE, 2);
  const shifted = `> A paragraph inserted above the list.\n>\n${NOTE}`;

  assert.equal(planTaskToggle(shifted, stale), undefined);
});

test("a task that has been deleted outright is refused", () => {
  const stale = taskAt(NOTE, 2);

  assert.equal(planTaskToggle("# Open work\n", stale), undefined);
});
