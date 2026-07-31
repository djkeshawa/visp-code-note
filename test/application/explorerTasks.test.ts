import assert = require("node:assert/strict");
import { test } from "node:test";
import { buildSnapshot } from "../../src/indexing/projections";
import {
  explorerRowId,
  fromBranch,
  noteChildren,
  notesWithTag,
  orphanNotes,
  taskNodes,
  todayStamp,
} from "../../src/vscode/providers/explorerModel";
import { makeNote } from "../indexing/fixtures";

const TODAY = "2026-07-26";

const PLANNING = makeNote({
  path: "notes/planning.md",
  content: [
    "# Planning",
    "",
    "- [ ] Undated groundwork",
    `- [ ] Ship the release @due(${TODAY})`,
    "- [x] Archive the old plan @due(2026-07-01)",
    "- [ ] Overdue review @due(2026-07-20)",
    "",
  ].join("\n"),
});

const snapshot = buildSnapshot([PLANNING]);

function labels(filter: "all" | "due"): readonly string[] {
  return taskNodes(snapshot, filter, TODAY).map((node) =>
    node.kind === "task" ? node.task.text : "");
}

test("open work sorts ahead of completed work, earliest due date first", () => {
  assert.deepEqual(labels("all"), [
    "Overdue review",
    "Ship the release",
    "Undated groundwork",
    "Archive the old plan",
  ]);
});

test("the due view holds exactly the incomplete work dated today", () => {
  // Overdue and completed work is excluded so the children match the badge count.
  assert.deepEqual(labels("due"), ["Ship the release"]);
});

test("a timestamped due date still counts as today", () => {
  const timed = makeNote({
    path: "notes/timed.md",
    content: `# Timed\n\n- [ ] Evening review @due(${TODAY}T18:00:00)\n`,
  });

  assert.deepEqual(
    taskNodes(buildSnapshot([timed]), "due", TODAY).map((node) =>
      node.kind === "task" ? node.task.text : ""),
    ["Evening review"],
  );
});

test("each row carries the index version it was built from", () => {
  // Toggling passes this back so a row rendered against a stale index is rejected rather
  // than edited. Reading the live version at click time would make that check inert.
  const versioned = buildSnapshot([PLANNING], 7);

  for (const node of taskNodes(versioned, "all", TODAY)) {
    assert.equal(node.kind === "task" ? node.snapshotVersion : undefined, 7);
  }
});

test("today's stamp is a sortable ISO date", () => {
  assert.equal(todayStamp(new Date(Date.UTC(2026, 6, 4, 12))), "2026-07-04");
  assert.match(todayStamp(), /^\d{4}-\d{2}-\d{2}$/);
});

test("a note reachable from several branches gets a distinct row id in each", () => {
  /*
   * The same note is a row under its folder, under every tag it carries and under Orphan Notes,
   * and VS Code requires TreeItem.id to be unique across the whole tree. Keying on the URI alone
   * meant the last row registered displaced the earlier ones, and the displaced row lost the
   * command that opens the note when clicked.
   */
  const note = makeNote({ path: "ideas.md", title: "Ideas", content: "# Ideas\n\n#research\n" });
  const snapshot = buildSnapshot([note], 1, 0);
  assert.deepEqual([...note.tags], ["research"]);

  const ids = [
    ...fromBranch(noteChildren(snapshot), "notes"),
    ...fromBranch(notesWithTag(snapshot, "research"), "tag:research"),
    ...fromBranch(orphanNotes(snapshot), "orphans"),
  ].map(explorerRowId);

  assert.equal(ids.length, 3, "the note should appear under notes, its tag and orphans");
  assert.equal(new Set(ids).size, 3, `row ids collided: ${JSON.stringify(ids)}`);
});

test("the same task under Tasks and Due Today gets a distinct row id in each", () => {
  const note = makeNote({ path: "today.md", title: "Today", content: `- [ ] ship it @due(${TODAY})\n` });
  const snapshot = buildSnapshot([note], 1, 0);

  const all = fromBranch(taskNodes(snapshot, "all", TODAY), "tasks").map(explorerRowId);
  const due = fromBranch(taskNodes(snapshot, "due", TODAY), "due").map(explorerRowId);

  assert.equal(all.length, 1);
  assert.equal(due.length, 1);
  assert.notEqual(all[0], due[0]);
});
