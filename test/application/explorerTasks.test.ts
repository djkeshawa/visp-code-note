import assert = require("node:assert/strict");
import { test } from "node:test";
import { buildSnapshot } from "../../src/indexing/projections";
import { taskNodes, todayStamp } from "../../src/vscode/providers/explorerModel";
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
