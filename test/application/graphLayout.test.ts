import assert = require("node:assert/strict");
import { test } from "node:test";
import type { GraphDataWire } from "../../src/webview/contracts";
import { layoutGraph } from "../../src/webview/graph/layout";
import { nodeDegrees, nodeHitRadius, nodeRadius } from "../../src/webview/graph/metrics";

const graph: GraphDataWire = {
  nodes: [
    { id: "note:focus", label: "Focus", kind: "note" },
    { id: "note:linked", label: "Linked", kind: "note" },
    { id: "note:other", label: "Other", kind: "note" },
    { id: "tag:graph", label: "#graph", kind: "tag" },
  ],
  edges: [
    { id: "focus-linked", source: "note:focus", target: "note:linked", kind: "link" },
    { id: "focus-tag", source: "note:focus", target: "tag:graph", kind: "tag" },
    { id: "linked-tag", source: "note:linked", target: "tag:graph", kind: "tag" },
  ],
  focusId: "note:focus",
};

test("keeps the local graph focus centered and returns finite positions", () => {
  const positions = layoutGraph(graph, { width: 600, height: 400 });

  assert.deepEqual(positions.get("note:focus"), { x: 300, y: 200 });
  assert.equal(positions.size, graph.nodes.length);
  for (const point of positions.values()) {
    assert.ok(Number.isFinite(point.x));
    assert.ok(Number.isFinite(point.y));
  }
});

test("spreads a hub neighborhood without pinning nodes into boundary rows", () => {
  const nodes = [
    { id: "note:hub", label: "Hub", kind: "note" as const },
    ...Array.from({ length: 20 }, (_, index) => ({
      id: `task:${index}`,
      label: `Task ${index}`,
      kind: "task" as const,
    })),
  ];
  const hubGraph: GraphDataWire = {
    nodes,
    edges: nodes.slice(1).map((node, index) => ({
      id: `edge:${index}`,
      source: "note:hub",
      target: node.id,
      kind: "task",
    })),
  };

  const positions = [...layoutGraph(hubGraph).values()];
  const alignedRows = new Map<number, number>();
  for (const point of positions) {
    alignedRows.set(point.y, (alignedRows.get(point.y) ?? 0) + 1);
  }
  assert.ok(Math.max(...alignedRows.values()) <= 2);
});

test("produces stable force-directed positions for unchanged graph data", () => {
  const first = [...layoutGraph(graph).entries()];
  const second = [...layoutGraph(graph).entries()];

  assert.deepEqual(first, second);
});

test("scales graph dots by visible connections while preserving a prominent focus", () => {
  const degrees = nodeDegrees(graph);
  const focus = graph.nodes[0]!;
  const other = graph.nodes[2]!;

  assert.equal(degrees.get(focus.id), 2);
  assert.equal(degrees.get(other.id), 0);
  assert.ok(nodeRadius(focus, 2, false) > nodeRadius(other, 0, false));
  assert.ok(nodeRadius(focus, 2, true) >= 12);
});

test("keeps the draggable node target comfortably larger than its visible shape", () => {
  assert.equal(nodeHitRadius(5.5), 20);
  assert.equal(nodeHitRadius(18), 25);
});

test("ignores self-links when measuring visual importance", () => {
  const selfLinked: GraphDataWire = {
    nodes: [graph.nodes[0]!],
    edges: [{ id: "self", source: "note:focus", target: "note:focus", kind: "link" }],
  };

  assert.equal(nodeDegrees(selfLinked).get("note:focus"), 0);
});
