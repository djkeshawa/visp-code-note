import assert = require("node:assert/strict");
import { test } from "node:test";
import type { GraphDataWire, GraphEdgeWire, GraphNodeWire } from "../../src/webview/contracts";
import {
  LABEL_DENSITY_LIMIT,
  STANDING_LABEL_BUDGET,
  nodeDegrees,
  standingLabelIds,
} from "../../src/webview/graph/metrics";

/**
 * A star-of-stars: `hubs` well-connected notes, each with `spokes` leaves hanging off it.
 * Leaves outnumber hubs, which is the shape that used to defeat a fixed degree threshold.
 */
function graphWith(hubs: number, spokes: number): GraphDataWire {
  const nodes: GraphNodeWire[] = [];
  const edges: GraphEdgeWire[] = [];
  for (let hub = 0; hub < hubs; hub += 1) {
    nodes.push({ id: `hub:${hub}`, label: `Hub ${hub}`, kind: "note" });
    for (let spoke = 0; spoke < spokes; spoke += 1) {
      const id = `leaf:${hub}:${spoke}`;
      nodes.push({ id, label: `Leaf ${hub}-${spoke}`, kind: "note" });
      edges.push({ id: `e:${id}`, source: `hub:${hub}`, target: id, kind: "link" });
    }
  }
  return { nodes, edges };
}

function labelled(graph: GraphDataWire): ReadonlySet<string> {
  return standingLabelIds(graph, nodeDegrees(graph));
}

test("a small graph labels every node", () => {
  const small = graphWith(2, 3);

  assert.ok(small.nodes.length <= LABEL_DENSITY_LIMIT);
  assert.equal(labelled(small).size, small.nodes.length);
});

test("a crowded graph never exceeds the label budget", () => {
  const crowded = graphWith(40, 20);

  assert.ok(crowded.nodes.length > 800);
  assert.ok(labelled(crowded).size <= STANDING_LABEL_BUDGET);
});

test("the budget goes to the most connected nodes", () => {
  const crowded = graphWith(40, 20);

  const ids = labelled(crowded);

  for (const id of ids) {
    assert.ok(id.startsWith("hub:"), `${id} is not a hub`);
  }
});

test("nodes with no visible connections never take a label slot", () => {
  const nodes: GraphNodeWire[] = Array.from({ length: 60 }, (_, index) => ({
    id: `orphan:${index}`,
    label: `Orphan ${index}`,
    kind: "note" as const,
  }));

  assert.equal(labelled({ nodes, edges: [] }).size, 0);
});

test("the selection is stable across repeated renders of the same graph", () => {
  const crowded = graphWith(40, 20);

  assert.deepEqual([...labelled(crowded)].sort(), [...labelled(crowded)].sort());
});
