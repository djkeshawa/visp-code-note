import assert = require("node:assert/strict");
import { test } from "node:test";
import { parseMarkdown } from "../../src/markdown/parser";

test("parses task state, metadata, tags, stable IDs, and patch-safe ranges", () => {
  const source = [
    "Intro",
    "- [X] Ship release #Release @due(2026-07-22) @priority(MEDIUM)",
    "    <!-- task:atlas-001 -->",
    "1. [ ] Follow up #ops/core @priority(high)",
    "+ [ ] Inline identity <!-- task:inline-2 -->",
  ].join("\r\n");
  const tasks = parseMarkdown(source).tasks;

  assert.equal(tasks.length, 3);
  assert.deepEqual(tasks[0], {
    id: "atlas-001",
    text: "Ship release",
    completed: true,
    due: "2026-07-22",
    priority: "medium",
    tags: ["Release"],
    range: {
      start: source.indexOf("- [X]"),
      end: source.indexOf("1. [ ]"),
    },
    checkboxRange: {
      start: source.indexOf("[X]") + 1,
      end: source.indexOf("[X]") + 2,
    },
    line: 1,
  });
  assert.equal(source.slice(tasks[0]?.checkboxRange.start, tasks[0]?.checkboxRange.end), "X");
  assert.equal(tasks[1]?.text, "Follow up");
  assert.equal(tasks[1]?.completed, false);
  assert.deepEqual(tasks[1]?.tags, ["ops/core"]);
  assert.equal(tasks[2]?.id, "inline-2");
  assert.equal(tasks[2]?.text, "Inline identity");
});

test("does not parse checkbox-like text in fenced or indented code", () => {
  const source = [
    "```md",
    "- [ ] fenced",
    "```",
    "",
    "    - [ ] indented",
    "",
    "- [y] not a task",
    "- [ ] actual",
  ].join("\n");
  const note = parseMarkdown(source);

  assert.deepEqual(note.tasks.map((task) => task.text), ["actual"]);
  assert.equal(note.blocks.filter((block) => block.kind === "task").length, 1);
});

test("reads a due time and a reminder lead, and keeps both out of the task text", () => {
  const source = [
    "- [ ] Ship release @due(2026-08-15 14:30) @remind(30m) @priority(high) #ops",
    "- [ ] Draft agenda @due(2026-08-15)",
  ].join("\n");
  const tasks = parseMarkdown(source).tasks;

  assert.equal(tasks[0]?.due, "2026-08-15 14:30");
  assert.equal(tasks[0]?.remind, "30m");
  assert.equal(tasks[0]?.text, "Ship release", "no metadata token survives into the text");
  assert.deepEqual(tasks[0]?.tags, ["ops"]);

  assert.equal(tasks[1]?.due, "2026-08-15");
  assert.equal(tasks[1]?.remind, undefined, "a task without @remind carries no lead at all");
});
