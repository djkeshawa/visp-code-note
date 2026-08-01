import assert = require("node:assert/strict");
import { test } from "node:test";
import { parseMarkdown } from "../../src/markdown/parser";
import {
  REMINDER_WITHOUT_DUE_CODE,
  UNREADABLE_DUE_CODE,
  UNREADABLE_REMINDER_CODE,
  taskMetadataProblems,
} from "../../src/application/taskMetadataProblems";

function problemsIn(source: string) {
  return taskMetadataProblems(source, parseMarkdown(source).tasks);
}

test("a task whose metadata works is reported as nothing at all", () => {
  assert.deepEqual(problemsIn("- [ ] Ship @due(2026-08-15 14:30) @remind(30m)\n"), []);
  assert.deepEqual(problemsIn("- [ ] Ship @due(2026-08-15)\n"), []);
  assert.deepEqual(problemsIn("- [ ] Ship with no metadata at all\n"), []);
  assert.deepEqual(problemsIn("- [x] Done @due(2026-08-15) @remind(1d)\n"), []);
});

/* A form the extension has always accepted must not acquire a warning. */
test("a whole ISO timestamp is not a problem", () => {
  assert.deepEqual(problemsIn("- [ ] Ship @due(2026-07-22T18:00:00) @remind(1h)\n"), []);
  assert.deepEqual(problemsIn("- [ ] Ship @due(2026-07-22T18:00:00Z)\n"), []);
});

test("a due date nobody can read is reported", () => {
  const [problem, ...rest] = problemsIn("- [ ] Ship @due(next friday)\n");
  assert.deepEqual(rest, [], "one problem, not one per token");
  assert.equal(problem?.code, UNREADABLE_DUE_CODE);
  assert.match(problem?.message ?? "", /next friday/);
  assert.match(problem?.message ?? "", /YYYY-MM-DD/, "it says what a readable one looks like");
});

test("a reminder with no due date to come before is reported", () => {
  const problems = problemsIn("- [ ] Ship @remind(30m)\n");
  assert.deepEqual(problems.map((problem) => problem.code), [REMINDER_WITHOUT_DUE_CODE]);
  assert.match(problems[0]?.message ?? "", /never fires/);
  assert.match(problems[0]?.message ?? "", /no @due/);
});

test("an unreadable lead is reported instead of the missing-due message", () => {
  const problems = problemsIn("- [ ] Ship @due(2026-08-15) @remind(soon)\n");
  assert.deepEqual(problems.map((problem) => problem.code), [UNREADABLE_REMINDER_CODE]);
  assert.match(problems[0]?.message ?? "", /soon/);
});

test("an unreadable due drags its reminder down with it, and both are named", () => {
  const problems = problemsIn("- [ ] Ship @due(friday) @remind(30m)\n");
  assert.deepEqual(
    problems.map((problem) => problem.code),
    [UNREADABLE_DUE_CODE, REMINDER_WITHOUT_DUE_CODE],
  );
  assert.match(problems[1]?.message ?? "", /cannot be read/);
});

test("a problem is anchored on the token, not on the whole task", () => {
  const source = "- [ ] Ship the release @due(next friday) more words\n";
  const [problem] = problemsIn(source);
  assert.equal(
    source.slice(problem?.range.start, problem?.range.end),
    "@due(next friday)",
    "the squiggle sits under the thing to fix",
  );
});

test("a reminder problem is anchored on the reminder, not on the due date", () => {
  const source = "- [ ] Ship @due(2026-08-15) @remind(whenever)\n";
  const [problem] = problemsIn(source);
  assert.equal(source.slice(problem?.range.start, problem?.range.end), "@remind(whenever)");
});

test("every task in a note is checked, and offsets stay right down the file", () => {
  const source = [
    "# Notes",
    "",
    "- [ ] First @due(2026-08-15)",
    "- [ ] Second @due(soon)",
    "- [ ] Third @remind(1h)",
    "",
  ].join("\n");
  const problems = problemsIn(source);
  assert.deepEqual(
    problems.map((problem) => problem.code),
    [UNREADABLE_DUE_CODE, REMINDER_WITHOUT_DUE_CODE],
  );
  assert.equal(source.slice(problems[0]?.range.start, problems[0]?.range.end), "@due(soon)");
  assert.equal(source.slice(problems[1]?.range.start, problems[1]?.range.end), "@remind(1h)");
});
