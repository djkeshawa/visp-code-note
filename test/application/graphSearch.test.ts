import assert = require("node:assert/strict");
import { test } from "node:test";
import { buildGraphSearch } from "../../src/application/graphSearch";
import { buildSnapshot, buildLocalGraph, buildWorkspaceGraph } from "../../src/indexing/projections";
import { makeNote } from "../indexing/fixtures";

const note = makeNote({ path: "research/navigation.md", aliases: ["Wayfinding"], content:
  "# Navigation\n\nThe quiet constellation connects ideas. #design\n\n- [ ] Review keyboard focus\n- [x] Review keyboard focus\n\n[[Neighbour]]\n",
});
const snapshot = buildSnapshot([note,
  makeNote({ path: "neighbour.md", content: "# Neighbour\n" }),
  makeNote({ path: "elsewhere.md", content: "# Elsewhere\n\nA quiet constellation.\n" }),
], 1, 1);
const graph = buildWorkspaceGraph(snapshot);
const options = { mode: "all" as const, kinds: ["note", "task", "tag", "unresolved"] as const, includeOrphans: true };

test("graph text search finds body text and returns a source preview and exact offset", () => {
  const page = buildGraphSearch(snapshot, graph, 'path:research "quiet constellation"', options);
  assert.equal(page.nodeIds.length, 1);
  assert.equal(page.results[0]?.matchedField, "body");
  assert.match(page.results[0]?.preview ?? "", /quiet constellation/);
  assert.equal(page.results[0]?.start, note.content.indexOf("quiet constellation"));
  assert.equal(page.results[0]?.uri, note.uri);
});

test("aliases, tags, and words in separate fields use the workspace query grammar", () => {
  assert.equal(buildGraphSearch(snapshot, graph, "Wayfinding", options).results[0]?.uri, note.uri);
  assert.equal(buildGraphSearch(snapshot, graph, "tag:design Navigation constellation", options).nodeIds.length, 1);
  assert.equal(buildGraphSearch(snapshot, graph, "author:unknown", options).nodeIds.length, 0);
});

test("task filters distinguish duplicate task labels and open the matching checkbox", () => {
  const page = buildGraphSearch(snapshot, graph, "is:done keyboard", options);
  assert.equal(page.nodeIds.length, 1);
  assert.equal(page.results[0]?.start, note.content.indexOf("- [x]"));
  assert.equal(graph.nodes.find((node) => node.id === page.nodeIds[0])?.kind, "task");
});

test("local scope and type/orphan filters apply before counting and limiting results", () => {
  const local = buildLocalGraph(snapshot, note.uri, 1);
  assert.equal(buildGraphSearch(snapshot, local, "constellation", options).nodeIds.length, 1);
  assert.equal(buildGraphSearch(snapshot, graph, "constellation", { ...options, includeOrphans: false }).nodeIds.length, 1);
  assert.equal(buildGraphSearch(snapshot, graph, "constellation", { ...options, kinds: ["task"] }).nodeIds.length, 0);
});

test("labels mode excludes body matches; result caps do not truncate graph highlights", () => {
  assert.equal(buildGraphSearch(snapshot, graph, "constellation", { ...options, mode: "labels" }).nodeIds.length, 0);
  const page = buildGraphSearch(snapshot, graph, "constellation", options, 1);
  assert.equal(page.results.length, 1);
  assert.equal(page.nodeIds.length, 2);
  assert.deepEqual(buildGraphSearch(snapshot, graph, "   ", options).nodeIds, []);
});
