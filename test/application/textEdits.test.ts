import assert = require("node:assert/strict");
import { test } from "node:test";
import { toggleTaskInSource } from "../../src/application/taskEditing";
import { applyTextEdits } from "../../src/application/textEdits";
import type { NoteTask } from "../../src/domain/models";

test("applies multiple offset edits without shifting later ranges", () => {
  const source = "alpha beta gamma";
  const result = applyTextEdits(source, [
    { start: 0, end: 5, text: "A" },
    { start: 11, end: 16, text: "G" },
  ]);

  assert.equal(result, "A beta G");
});

test("rejects overlapping or out-of-bounds text edits", () => {
  assert.throws(
    () => applyTextEdits("abcdef", [
      { start: 1, end: 4, text: "x" },
      { start: 3, end: 5, text: "y" },
    ]),
    /Overlapping/,
  );
  assert.throws(
    () => applyTextEdits("abcdef", [{ start: 0, end: 10, text: "x" }]),
    /Invalid text edit range/,
  );
});

test("toggles only the indexed task status character", () => {
  const source = "before\n- [ ] Keep formatting @due(2026-07-22)\nafter";
  const status = source.indexOf("[ ]") + 1;
  const task: NoteTask = {
    text: "Keep formatting",
    completed: false,
    tags: [],
    range: { start: source.indexOf("- [ ]"), end: source.indexOf("\nafter") },
    checkboxRange: { start: status, end: status + 1 },
    line: 1,
  };

  const result = toggleTaskInSource(source, task);
  assert.equal(result, "before\n- [x] Keep formatting @due(2026-07-22)\nafter");
});
