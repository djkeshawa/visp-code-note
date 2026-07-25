import assert = require("node:assert/strict");
import { test } from "node:test";
import { planTaskLine } from "../../src/application/taskLine";

test("toggles only an existing Markdown checkbox status", () => {
  assert.deepEqual(planTaskLine("  - [ ] Keep text", "unused"), {
    kind: "toggle",
    start: 5,
    end: 6,
    text: "x",
  });
  assert.equal(planTaskLine("1. [X] Done", "unused").text, " ");
});

test("converts plain and list text to stable Markdown tasks", () => {
  assert.deepEqual(planTaskLine("  Review design", "task-1"), {
    kind: "convert",
    text: "  - [ ] Review design <!-- task:task-1 -->",
  });
  assert.deepEqual(planTaskLine("* Existing bullet", "task-2"), {
    kind: "convert",
    text: "* [ ] Existing bullet <!-- task:task-2 -->",
  });
});

test("places the caret before metadata on an empty task", () => {
  assert.deepEqual(planTaskLine("", "task-3"), {
    kind: "convert",
    text: "- [ ]  <!-- task:task-3 -->",
    caretOffset: 6,
  });
});
