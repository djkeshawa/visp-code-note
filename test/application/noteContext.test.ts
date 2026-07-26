import assert = require("node:assert/strict");
import { test } from "node:test";
import { buildNoteContext, buildSnapshot } from "../../src/indexing/projections";
import { makeNote } from "../indexing/fixtures";

const ATLAS = makeNote({
  path: "notes/projects/atlas.md",
  content: [
    "---",
    "title: Project Atlas",
    "tags: [project, product]",
    "---",
    "",
    "Links to [[Architecture decisions]] and [[Launch checklist]].",
    "",
    "- [ ] Prototype live editing",
    "- [x] Confirm alias syntax",
    "- [ ] Add diagnostics",
    "",
  ].join("\n"),
});

const ARCHITECTURE = makeNote({
  path: "notes/architecture-decisions.md",
  content: "# Architecture decisions\n\nSee [[Project Atlas]].\n",
});

const CHECKLIST = makeNote({
  path: "notes/launch-checklist.md",
  content: "# Launch checklist\n\nTracked in [[Project Atlas]].\n",
});

const snapshot = buildSnapshot([ATLAS, ARCHITECTURE, CHECKLIST]);

test("breaks the workspace path into breadcrumb folders and a file name", () => {
  const context = buildNoteContext(snapshot, ATLAS.uri);

  assert.deepEqual(context?.folders, ["notes", "projects"]);
  assert.equal(context?.fileName, "atlas.md");
});

test("counts links in both directions and open tasks", () => {
  const context = buildNoteContext(snapshot, ATLAS.uri);

  assert.equal(context?.outgoingCount, 2);
  assert.equal(context?.backlinkCount, 2);
  assert.equal(context?.taskCount, 3);
  assert.equal(context?.openTaskCount, 2);
});

test("surfaces frontmatter tags in declaration order", () => {
  assert.deepEqual(buildNoteContext(snapshot, ATLAS.uri)?.tags, ["project", "product"]);
});

test("a note at the workspace root has no breadcrumb folders", () => {
  const root = makeNote({ path: "readme.md", content: "# Readme\n" });

  const context = buildNoteContext(buildSnapshot([root]), root.uri);

  assert.deepEqual(context?.folders, []);
  assert.equal(context?.fileName, "readme.md");
});

test("an unindexed note yields no context instead of empty counters", () => {
  assert.equal(buildNoteContext(snapshot, "file:///untracked.md"), undefined);
});
