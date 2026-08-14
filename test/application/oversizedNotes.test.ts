import assert = require("node:assert/strict");
import { test } from "node:test";
import type { SkippedNote } from "../../src/domain/models";
import {
  describeOversizedNote,
  oversizedReason,
  oversizedTally,
} from "../../src/application/oversizedNotes";

const LIMIT = 5120 * 1024;

function skip(path: string, sizeKB: number, limitKB = 5120): SkippedNote {
  return {
    uri: `file:///${path}`,
    path,
    sizeBytes: sizeKB * 1024,
    limitBytes: limitKB * 1024,
  };
}

test("nothing is said when nothing was skipped", () => {
  assert.equal(oversizedReason([]), undefined);
});

/*
 * The three things a reader needs to get from "my note is gone" to the setting that removed
 * it: that a note is missing, that its size is why, and the name of the setting to change.
 * Before this, all three were unavailable anywhere in the product.
 */
test("one skipped note names the count, the ceiling, and the setting", () => {
  const reason = oversizedReason([skip("notes/enormous.md", 8000)]);

  assert.ok(reason !== undefined);
  assert.match(reason, /^1 note is larger than the 5120 KB limit/);
  assert.match(reason, /not indexed/);
  assert.match(reason, /vispNotes\.maxNoteSizeKB/);
});

test("several skipped notes are counted, and read as several", () => {
  const reason = oversizedReason([
    skip("a.md", 8000),
    skip("b.md", 9000),
    skip("c.md", 10_000),
  ]) ?? "";

  assert.match(reason, /^3 notes are larger/);
  assert.match(reason, /they are not indexed/);
  assert.doesNotMatch(reason, /\bit is not indexed\b/);
});

/*
 * A workspace folder can set its own ceiling, so a window holding two folders can skip notes
 * measured against two different limits. Naming one of them would send the reader to change a
 * setting that had nothing to do with their note.
 */
test("a ceiling is only named when every skipped note was measured against the same one", () => {
  const mixed = oversizedReason([skip("a.md", 8000, 5120), skip("b.md", 900, 512)]) ?? "";

  assert.doesNotMatch(mixed, /5120 KB/);
  assert.doesNotMatch(mixed, /512 KB/);
  assert.match(mixed, /their size limit/);
  assert.match(mixed, /vispNotes\.maxNoteSizeKB/);
});

test("the tally is short enough to sit beside the note and task counts", () => {
  assert.equal(oversizedTally(1), "1 not indexed");
  assert.equal(oversizedTally(12), "12 not indexed");
});

/*
 * The sentence shown to someone who clicked a link and would otherwise have been offered
 * "Create Note". It has to say the file is already there, because the offer it replaces was an
 * invitation to overwrite it.
 */
test("a clicked link names the file, its size, and says nothing needs creating", () => {
  const message = describeOversizedNote(skip("notes/enormous.md", 8000));

  assert.match(message, /notes\/enormous\.md/);
  assert.match(message, /8000 KB/);
  assert.match(message, /5120 KB/);
  assert.match(message, /vispNotes\.maxNoteSizeKB/);
  assert.match(message, /nothing needs creating/i);
});

test("sizes are reported in the unit the setting is written in", () => {
  const message = describeOversizedNote({
    uri: "file:///big.md",
    path: "big.md",
    sizeBytes: LIMIT + 1,
    limitBytes: LIMIT,
  });

  assert.match(message, /5120 KB/);
});
