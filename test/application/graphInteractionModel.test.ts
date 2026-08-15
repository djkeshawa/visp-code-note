import assert = require("node:assert/strict");
import { test } from "node:test";
import type { GraphDataWire } from "../../src/webview/contracts";
import {
  connectionsFor,
  cycleNodeId,
  filterGraph,
  findMatchingNodeIds,
  graphAroundMatches,
  keyboardNodeId,
  resolveSelection,
} from "../../src/webview/graph/interactionModel";

const graph: GraphDataWire = {
  nodes: [
    { id: "note:a", label: "Project Atlas", kind: "note", uri: "file:///a.md" },
    { id: "note:b", label: "Architecture", kind: "note", uri: "file:///b.md" },
    { id: "note:c", label: "Ideas", kind: "note", uri: "file:///c.md", orphan: true },
    { id: "task:a:1", label: "Draft architecture", kind: "task", uri: "file:///a.md" },
    { id: "tag:design", label: "#design", kind: "tag" },
  ],
  edges: [
    { id: "a-b", source: "note:a", target: "note:b", kind: "link" },
    { id: "b-a", source: "note:b", target: "note:a", kind: "link" },
    { id: "a-task", source: "note:a", target: "task:a:1", kind: "task" },
    { id: "a-tag", source: "note:a", target: "tag:design", kind: "tag" },
  ],
  focusId: "note:a",
};

test("filters node kinds and orphans without leaving dangling edges", () => {
  const filtered = filterGraph(graph, new Set(["note", "task"]), false);

  assert.deepEqual(filtered.nodes.map((node) => node.id), ["note:a", "note:b", "task:a:1"]);
  assert.deepEqual(filtered.edges.map((edge) => edge.id), ["a-b", "b-a", "a-task"]);
  assert.equal(filtered.focusId, "note:a");
});

test("preserves a valid selection and falls back to focus deterministically", () => {
  assert.equal(resolveSelection(graph, "note:b"), "note:b");
  assert.equal(resolveSelection(graph, "missing"), "note:a");
  assert.equal(resolveSelection({ nodes: [], edges: [] }, "note:a"), undefined);
});

test("leaves a workspace graph unselected until the user chooses a node", () => {
  const workspaceGraph: GraphDataWire = { nodes: graph.nodes, edges: graph.edges };

  assert.equal(resolveSelection(workspaceGraph, undefined), undefined);
  assert.equal(resolveSelection(workspaceGraph, "missing"), undefined);
});

test("finds case-insensitive labels and cycles matches in both directions", () => {
  const matches = findMatchingNodeIds(graph, "ARCH");

  assert.deepEqual(matches, ["note:b", "task:a:1"]);
  assert.equal(cycleNodeId(matches, undefined, 1), "note:b");
  assert.equal(cycleNodeId(matches, "note:b", -1), "task:a:1");
  assert.equal(cycleNodeId(matches, "task:a:1", 1), "note:b");
});

test("a matches-only search keeps the matches and what they are linked to", () => {
  const restricted = graphAroundMatches(graph, findMatchingNodeIds(graph, "ideas"));

  // Ideas links to nothing, so it arrives alone rather than dragging the graph with it.
  assert.deepEqual(restricted.nodes.map((node) => node.id), ["note:c"]);
  assert.deepEqual(restricted.edges, []);
});

test("the neighbours of a match do not bring their own neighbours with them", () => {
  // Architecture matches; note:a is its neighbour; the tag and the task hang off note:a and
  // must stay off the canvas, or one hop turns into two and the graph fills back up.
  const restricted = graphAroundMatches(graph, ["note:b"]);

  assert.deepEqual(restricted.nodes.map((node) => node.id), ["note:a", "note:b"]);
  assert.deepEqual(restricted.edges.map((edge) => edge.id), ["a-b", "b-a"]);
  assert.equal(restricted.focusId, "note:a");
});

test("a search that matches nothing leaves an empty canvas, not the whole graph", () => {
  const restricted = graphAroundMatches(graph, []);

  assert.deepEqual(restricted.nodes, []);
  assert.equal(restricted.focusId, undefined);
});

test("maps Home and End onto the roving node boundaries", () => {
  const nodeIds = graph.nodes.map((node) => node.id);

  assert.equal(keyboardNodeId(nodeIds, "Home"), "note:a");
  assert.equal(keyboardNodeId(nodeIds, "End"), "tag:design");
  assert.equal(keyboardNodeId(nodeIds, "PageDown"), undefined);
});

test("deduplicates reciprocal neighbors while retaining direction and edge type", () => {
  const connections = connectionsFor(graph, "note:a");

  assert.deepEqual(connections.map((connection) => ({
    id: connection.node.id,
    direction: connection.direction,
    edgeKinds: connection.edgeKinds,
  })), [
    { id: "note:b", direction: "both", edgeKinds: ["link"] },
    { id: "task:a:1", direction: "outgoing", edgeKinds: ["task"] },
    { id: "tag:design", direction: "outgoing", edgeKinds: ["tag"] },
  ]);
});

test("excludes a self-link from the visible connection list", () => {
  const selfLinked: GraphDataWire = {
    nodes: [graph.nodes[0]!],
    edges: [{ id: "self", source: "note:a", target: "note:a", kind: "link" }],
  };

  assert.deepEqual(connectionsFor(selfLinked, "note:a"), []);
  assert.deepEqual(filterGraph(selfLinked, new Set(["note"]), true).edges, []);
});
