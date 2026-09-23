import assert = require("node:assert/strict");
import { test } from "node:test";
import {
  describeLinkPath,
  describeNeighbourhood,
  describeNote,
  describeSearch,
  describeTasks,
  NOTE_CONTENT_LIMIT,
  resolveNoteReference,
} from "../../src/application/agentContext";
import { buildSnapshot } from "../../src/indexing/projections";
import { makeNote } from "../indexing/fixtures";

const architecture = makeNote({ path: "eng/architecture.md", aliases: ["ADRs"], content:
  "---\ntags: [engineering]\n---\n# Architecture\n\nSee [[Indexing]] and [[Observability]].\n\n## Open\n\n- [ ] Write the cache ADR @due(2026-09-20) @priority(high)\n- [x] Ship search\n" });
const indexing = makeNote({ path: "eng/indexing.md", content: "# Indexing\n\nFeeds [[Graph]].\n" });
const graph = makeNote({ path: "research/graph.md", content: "# Graph\n\nLayout notes. #engineering\n\n- [ ] Tune theta @due(2026-09-24)\n" });
const journal = makeNote({ path: "journal/w38.md", content: "# Week 38\n\nRevisited [[Architecture]] today.\n" });
const lonely = makeNote({ path: "lonely.md", content: "# Lonely\n\nNo links. #engineering\n" });
const snapshot = buildSnapshot([architecture, indexing, graph, journal, lonely], 1, 1);

test("a note is found by title, alias, path or wiki-link text", () => {
  for (const reference of ["Architecture", "ADRs", "eng/architecture.md", "[[Architecture]]"]) {
    assert.equal(resolveNoteReference(snapshot, reference)?.uri, architecture.uri, reference);
  }
  assert.equal(resolveNoteReference(snapshot, "Nothing like it"), undefined);
});

test("describing a note gives its path, both directions of links, tasks and text", () => {
  const text = describeNote(snapshot, architecture);
  assert.match(text, /Path: `eng\/architecture\.md`/);
  assert.match(text, /\[\[Indexing\]\] → `eng\/indexing\.md`/);
  assert.match(text, /\[\[Observability\]\] — no such note yet/);
  assert.match(text, /`journal\/w38\.md` line 3: Revisited \[\[Architecture\]\] today\./);
  assert.match(text, /\[ \] Write the cache ADR \(due 2026-09-20, high priority\)/);
  assert.match(text, /## Content/);
});

test("unsaved text replaces the indexed text, and a huge note is cut", () => {
  assert.match(describeNote(snapshot, architecture, "# Draft only\n"), /# Draft only/);
  const huge = describeNote(snapshot, architecture, "x".repeat(NOTE_CONTENT_LIMIT + 10));
  assert.match(huge, /Cut at 24000 of 24010 characters/);
});

test("the neighbourhood keeps link direction, reaches two hops, and suggests shared-tag notes", () => {
  const text = describeNeighbourhood(snapshot, architecture, 2);
  assert.match(text, /Architecture links to \*\*Indexing\*\*/);
  assert.match(text, /Architecture is linked from \*\*Week 38\*\*/);
  assert.match(text, /Indexing links to \*\*Graph\*\* `research\/graph\.md` \(via Indexing\)/);
  assert.match(text, /\[\[Observability\]\]/);
  assert.match(text, /Share a tag but are not linked[\s\S]*\*\*Lonely\*\*/);
  assert.doesNotMatch(text.split("Share a tag")[1] ?? "", /Graph/, "a linked note is not suggested again");
});

test("a link path is the shortest chain, with each step's direction", () => {
  const text = describeLinkPath(snapshot, journal, graph);
  assert.match(text, /3 links apart/);
  assert.match(text, /1\. \*\*Week 38\*\* links to \*\*Architecture\*\*/);
  assert.match(text, /3\. \*\*Indexing\*\* links to \*\*Graph\*\*/);
  assert.match(describeLinkPath(snapshot, lonely, graph), /No chain of links/);
});

test("tasks filter by status, due bucket and note, late first", () => {
  const open = describeTasks(snapshot, {}, "2026-09-24");
  assert.ok(open.indexOf("Write the cache ADR") < open.indexOf("Tune theta"), "overdue before today");
  assert.match(open, /Write the cache ADR.*\*\*overdue\*\*/);
  assert.doesNotMatch(open, /Ship search/);
  assert.match(describeTasks(snapshot, { status: "done" }, "2026-09-24"), /\[x\] Ship search/);
  assert.match(describeTasks(snapshot, { due: "today" }, "2026-09-24"), /^1 task/);
  assert.equal(describeTasks(snapshot, { note: lonely }, "2026-09-24"), "No tasks match.");
});

test("search uses the workspace query grammar", () => {
  assert.match(describeSearch(snapshot, "path:research theta"), /Tune theta.*research\/graph\.md/);
  assert.match(describeSearch(snapshot, "zzz-nothing"), /No notes or tasks match/);
});
