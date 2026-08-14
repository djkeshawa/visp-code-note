import assert = require("node:assert/strict");
import { test } from "node:test";
import { buildWorkspaceSearchPage } from "../../src/application/workspaceSearch";
import { buildSnapshot } from "../../src/indexing/projections";
import { makeNote } from "../indexing/fixtures";

/**
 * A search that stops at its limit has to say so. "Your note is match 340 of 1,284" and
 * "there is no such note" are the same picture otherwise, and the reader responds to the
 * second one — by retyping a query that was already right, or by concluding the note is gone.
 */

const notes = Array.from({ length: 40 }, (_, index) =>
  makeNote({
    path: `notes/note-${index}.md`,
    content: `# Meeting ${index}\nThe quarterly retrospective, note ${index}.\n`,
  }));
const snapshot = buildSnapshot(notes, 1, 1);

test("a capped list reports how many matched, not how many it returned", () => {
  const page = buildWorkspaceSearchPage(snapshot, "retrospective", 5);

  assert.equal(page.results.length, 5);
  assert.equal(page.matched, 40);
});

test("a list that fits reports exactly what is on screen", () => {
  const page = buildWorkspaceSearchPage(snapshot, "note-7", 200);

  assert.equal(page.results.length, 1);
  assert.equal(page.matched, 1, "nothing was cut off, so there is nothing to warn about");
});

test("tasks count towards the answer, because they are rows in the same list", () => {
  const withTasks = buildSnapshot(
    Array.from({ length: 3 }, (_, index) =>
      makeNote({
        path: `notes/chore-${index}.md`,
        content: `# Chore ${index}\n- [ ] Sweep the quarterly retrospective notes\n`,
      })),
    1,
    1,
  );

  const page = buildWorkspaceSearchPage(withTasks, "retrospective", 2);
  assert.equal(page.results.length, 2);
  assert.equal(page.matched, 6, "three notes and three tasks match");
});

test("a query that matches nothing matches nothing, loudly", () => {
  const page = buildWorkspaceSearchPage(snapshot, "nowhere-at-all", 200);

  assert.equal(page.results.length, 0);
  assert.equal(page.matched, 0);
});
