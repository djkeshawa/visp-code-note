import assert = require("node:assert/strict");
import { test } from "node:test";
import {
  buildLocalGraph,
  buildSnapshot,
  buildWorkspaceGraph,
} from "../../src/indexing/projections";
import { makeNote } from "./fixtures";

test("workspace graph includes notes, tasks, tags, unresolved targets, and orphans", () => {
  const notes = graphNotes();
  const snapshot = buildSnapshot(notes, 1, 1);
  const graph = buildWorkspaceGraph(snapshot);

  assert.deepEqual(countKinds(graph.nodes), { note: 4, task: 1, tag: 2, unresolved: 1 });
  assert.equal(
    graph.nodes.find((node) => node.uri === notes[3]?.uri)?.orphan,
    true,
  );
  assert.ok(graph.edges.some((edge) => edge.kind === "link"));
  assert.ok(graph.edges.some((edge) => edge.kind === "task"));
  assert.ok(graph.edges.some((edge) => edge.kind === "tag"));
  assert.ok(Object.isFrozen(graph.nodes));
  assert.ok(Object.isFrozen(graph.edges));

  const notesOnly = buildWorkspaceGraph(snapshot, {
    includeTasks: false,
    includeTags: false,
    includeUnresolved: false,
    includeOrphans: false,
  });
  assert.deepEqual(countKinds(notesOnly.nodes), { note: 3, task: 0, tag: 0, unresolved: 0 });
  assert.ok(notesOnly.edges.every((edge) => edge.kind === "link"));
});

test("local graph follows incoming and outgoing links to the requested depth", () => {
  const notes = graphNotes();
  const snapshot = buildSnapshot(notes, 1, 1);

  const oneHop = buildLocalGraph(snapshot, notes[0]?.uri ?? "", 1);
  const twoHops = buildLocalGraph(snapshot, notes[0]?.uri ?? "", 2);
  assert.deepEqual(noteUris(oneHop), [notes[0]?.uri, notes[1]?.uri].sort());
  assert.deepEqual(noteUris(twoHops), [notes[0]?.uri, notes[1]?.uri, notes[2]?.uri].sort());
  assert.equal(oneHop.focusId, `note:${notes[0]?.uri}`);

  const inbound = buildLocalGraph(snapshot, notes[2]?.uri ?? "", 1);
  assert.deepEqual(noteUris(inbound), [notes[1]?.uri, notes[2]?.uri].sort());
  assert.deepEqual(buildLocalGraph(snapshot, "file:///missing.md", 1), {
    nodes: [],
    edges: [],
  });
});

function graphNotes() {
  return [
    makeNote({
      path: "graph/A.md",
      content: [
        "# A #project",
        "Links to [[B]] and [[Missing]].",
        "- [ ] Investigate #todo",
        "  <!-- task:a-task -->",
      ].join("\n"),
    }),
    makeNote({ path: "graph/B.md", content: "# B\n[[C]]\n" }),
    makeNote({ path: "graph/C.md" }),
    makeNote({ path: "graph/D.md" }),
  ] as const;
}

function countKinds(nodes: readonly { readonly kind: string }[]) {
  const counts = { note: 0, task: 0, tag: 0, unresolved: 0 };
  for (const node of nodes) counts[node.kind as keyof typeof counts] += 1;
  return counts;
}

function noteUris(graph: { readonly nodes: readonly { readonly kind: string; readonly uri?: string }[] }) {
  return graph.nodes
    .filter((node) => node.kind === "note")
    .map((node) => node.uri)
    .sort();
}
