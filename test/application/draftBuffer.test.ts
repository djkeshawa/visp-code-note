import assert = require("node:assert/strict");
import { test } from "node:test";
import { DraftBuffer } from "../../src/application/draftBuffer";
import { createTextPatch } from "../../src/application/textPatch";

test("retains and coalesces the newest draft while an earlier write is pending", () => {
  const buffer = new DraftBuffer("base", 1);
  buffer.push(patch("base", "draft A", 1, 1));
  const firstTarget = buffer.nextDraft();
  assert.equal(firstTarget?.source, "draft A");

  buffer.push(patch("draft A", "draft B", 2, 1));
  buffer.accept(firstTarget?.source ?? "", 2, firstTarget?.sequence ?? 0);

  assert.equal(buffer.nextDraft()?.source, "draft B");
  buffer.accept("draft B", 3, 2);
  assert.equal(buffer.nextDraft(), undefined);
});

test("ignores duplicate sequences and preserves save intent until edits are accepted", () => {
  const buffer = new DraftBuffer("base", 5);
  assert.equal(buffer.push(patch("base", "draft", 1, 5)), true);
  assert.equal(buffer.push(patch("draft", "ignored", 1, 5)), false);
  buffer.requestSave();
  assert.equal(buffer.takeSaveRequest(), false);
  buffer.accept("draft", 6, 1);
  assert.equal(buffer.takeSaveRequest(), true);
  assert.equal(buffer.takeSaveRequest(), false);
});

test("rebases a recoverable draft session onto authoritative text", () => {
  const buffer = new DraftBuffer("old", 1);
  buffer.push(patch("old", "local", 1, 1));
  buffer.rebase("external", 4);

  assert.equal(buffer.snapshot.acceptedSource, "external");
  assert.equal(buffer.snapshot.projectedSource, "external");
  assert.equal(buffer.snapshot.lastSequence, 1);
});

test("settles the newest sequence when typing returns to accepted text", () => {
  const buffer = new DraftBuffer("base", 1);
  buffer.push(patch("base", "changed", 1, 1));
  buffer.push(patch("changed", "base", 2, 1));

  assert.equal(buffer.nextDraft(), undefined);
  buffer.settleUnchangedDraft();
  assert.equal(buffer.snapshot.acceptedSequence, 2);
});

test("rejects stale patches after rebasing onto an external document version", () => {
  const buffer = new DraftBuffer("A!", 2);
  buffer.rebase("ZZ", 3);

  assert.throws(
    () => buffer.push(patch("A!", "A!x", 1, 2)),
    /unknown document version/,
  );
  assert.equal(buffer.snapshot.projectedSource, "ZZ");
});

function patch(before: string, after: string, sequence: number, baseVersion: number) {
  const value = createTextPatch(before, after);
  assert.ok(value);
  return { ...value, sequence, baseVersion };
}
