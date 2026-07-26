import assert = require("node:assert/strict");
import { test } from "node:test";
import type { GraphDataWire } from "../../src/webview/contracts";
import {
  buildAdjacency,
  edgeEmphasisMask,
  nodeEmphasisMask,
} from "../../src/webview/graph/emphasisModel";
import type { EmphasisInput } from "../../src/webview/graph/emphasisModel";

const graph: GraphDataWire = {
  nodes: [
    { id: "a", label: "A", kind: "note" },
    { id: "b", label: "B", kind: "note" },
    { id: "c", label: "C", kind: "note" },
    { id: "lonely", label: "Lonely", kind: "note" },
  ],
  edges: [
    { id: "a-b", source: "a", target: "b", kind: "link" },
    { id: "b-c", source: "b", target: "c", kind: "link" },
    { id: "self", source: "c", target: "c", kind: "link" },
  ],
};

const adjacency = buildAdjacency(graph);

function input(overrides: Partial<EmphasisInput> = {}): EmphasisInput {
  const base: EmphasisInput = {
    selectedId: undefined,
    hoveredId: undefined,
    matchingIds: new Set(),
    searchActive: false,
    tabStopId: undefined,
    neighborIds: new Set(),
  };
  const merged = { ...base, ...overrides };
  const emphasisId = merged.hoveredId ?? merged.selectedId;
  return {
    ...merged,
    neighborIds: overrides.neighborIds
      ?? (emphasisId === undefined ? new Set() : adjacency.get(emphasisId) ?? new Set()),
  };
}

test("adjacency is symmetric and drops self-links", () => {
  assert.deepEqual([...(adjacency.get("a") ?? [])], ["b"]);
  assert.deepEqual([...(adjacency.get("b") ?? [])].sort(), ["a", "c"]);
  assert.deepEqual([...(adjacency.get("c") ?? [])], ["b"]);
  assert.equal(adjacency.get("lonely"), undefined);
});

test("with nothing emphasised every node shares the same neutral mask", () => {
  const state = input();

  const masks = graph.nodes.map((node) => nodeEmphasisMask(node.id, state));

  assert.deepEqual(masks, [0, 0, 0, 0]);
});

test("hovering marks the source and its neighbours and dims the rest", () => {
  const state = input({ hoveredId: "b", tabStopId: "b" });

  const source = nodeEmphasisMask("b", state);
  const neighbour = nodeEmphasisMask("a", state);
  const distant = nodeEmphasisMask("lonely", state);

  assert.notEqual(source, neighbour);
  assert.notEqual(neighbour, distant);
  // The dimmed mask must differ from the neighbour mask, or the diff would skip the write.
  assert.notEqual(distant, 0);
  assert.equal(nodeEmphasisMask("c", state), neighbour);
});

test("only the changed bits differ when the pointer moves between neighbours", () => {
  const before = nodeEmphasisMask("a", input({ hoveredId: "b" }));
  const after = nodeEmphasisMask("a", input({ hoveredId: "a" }));

  assert.notEqual(before, after);
  // A node untouched by the move keeps an identical mask, which is what lets apply() skip it.
  assert.equal(
    nodeEmphasisMask("lonely", input({ hoveredId: "b" })),
    nodeEmphasisMask("lonely", input({ hoveredId: "a" })),
  );
});

test("search dims non-matches and marks matches without disturbing selection", () => {
  const state = input({ selectedId: "a", searchActive: true, matchingIds: new Set(["c"]) });

  const match = nodeEmphasisMask("c", state);
  const nonMatch = nodeEmphasisMask("lonely", state);

  assert.notEqual(match, nonMatch);
  assert.notEqual(nodeEmphasisMask("a", state), nonMatch);
});

test("an edge is connected when either end is emphasised", () => {
  const state = input({ hoveredId: "b" });

  const touching = edgeEmphasisMask("a", "b", state);
  const untouched = edgeEmphasisMask("lonely", "lonely", state);

  assert.notEqual(touching, untouched);
  assert.equal(edgeEmphasisMask("b", "c", state), touching);
});

test("edges with an unknown endpoint stay neutral instead of throwing", () => {
  assert.equal(edgeEmphasisMask(undefined, undefined, input()), 0);
});
