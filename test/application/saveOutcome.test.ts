import assert = require("node:assert/strict");
import { test } from "node:test";
import { saveOutcome } from "../../src/application/saveOutcome";

/**
 * What pressing save has to do, written as the reader would state it rather than as the code
 * happens to branch. Each case is a sentence about a keyboard and a file.
 */

test("saving a note with unsaved changes writes it", () => {
  assert.equal(saveOutcome(true, true, false), "written");
});

/*
 * The reported bug. Ctrl+S on a note nobody has edited — or Ctrl+S pressed twice — must not
 * say the note could not be saved. There is simply nothing to write.
 */
test("saving a note with nothing unsaved is not a failure", () => {
  assert.equal(saveOutcome(false, false, false), "nothing-to-write");
});

test("a save that genuinely fails leaves the note unsaved and says so", () => {
  assert.equal(saveOutcome(true, false, true), "failed");
});

/*
 * A save participant or an external writer can flush the file while the save call is in
 * flight, which makes the call report failure for a write that happened. The file is the
 * evidence, not the return value.
 */
test("a save reported as failed but with nothing left unsaved counts as written", () => {
  assert.equal(saveOutcome(true, false, false), "written");
});

test("a note reported clean is never called a failure, whatever the save call returned", () => {
  for (const reported of [true, false]) {
    assert.equal(
      saveOutcome(false, reported, false),
      "nothing-to-write",
      `reportedSaved=${reported}`,
    );
  }
});
