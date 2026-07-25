import assert = require("node:assert/strict");
import { test } from "node:test";
import { applyTextPatch, createTextPatch } from "../../src/application/textPatch";

test("creates the smallest insertion, replacement, and deletion patches", () => {
  assert.deepEqual(createTextPatch("hello world", "hello brave world"), {
    start: 6,
    end: 6,
    source: "brave ",
    expectedSource: "",
  });
  assert.deepEqual(createTextPatch("before middle after", "before center after"), {
    start: 7,
    end: 13,
    source: "center",
    expectedSource: "middle",
  });
  assert.deepEqual(createTextPatch("keep remove keep", "keep keep"), {
    start: 5,
    end: 12,
    source: "",
    expectedSource: "remove ",
  });
  assert.equal(createTextPatch("unchanged", "unchanged"), undefined);
});

test("preserves raw LF, CRLF, and CR content", () => {
  for (const ending of ["\n", "\r\n", "\r"]) {
    const before = `one${ending}two${ending}three`;
    const after = `one${ending}second${ending}three`;
    const patch = createTextPatch(before, after);
    assert.ok(patch);
    assert.equal(applyTextPatch(before, patch), after);
    assert.equal(patch.expectedSource, "two");
    assert.equal(patch.source, "second");
  }
});

test("does not split UTF-16 surrogate pairs at patch boundaries", () => {
  const patch = createTextPatch("A😀B", "A😁B");
  assert.deepEqual(patch, {
    start: 1,
    end: 3,
    source: "😁",
    expectedSource: "😀",
  });
  assert.equal(applyTextPatch("A😀B", patch), "A😁B");

  const insertion = createTextPatch("A😀B", "A😀!B");
  assert.ok(insertion);
  assert.equal(insertion.start, 3);
  assert.equal(applyTextPatch("A😀B", insertion), "A😀!B");
});

test("rejects a patch whose expected source no longer matches", () => {
  const patch = createTextPatch("alpha", "alpaca");
  assert.ok(patch);
  assert.throws(() => applyTextPatch("altered", patch), /does not match/);
});
