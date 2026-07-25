import assert = require("node:assert/strict");
import { test } from "node:test";
import type { GraphDataWire } from "../../src/webview/contracts";
import { LiveForceSimulation } from "../../src/webview/graph/liveForceSimulation";

const linkedGraph: GraphDataWire = {
  nodes: [
    { id: "note:a", label: "A", kind: "note" },
    { id: "note:b", label: "B", kind: "note" },
  ],
  edges: [{ id: "a-b", source: "note:a", target: "note:b", kind: "link" }],
};

test("keeps the dragged node pinned while its neighbor responds to the link spring", () => {
  const simulation = new LiveForceSimulation(linkedGraph, new Map([
    ["note:a", { x: 200, y: 320 }],
    ["note:b", { x: 300, y: 320 }],
  ]));

  simulation.pin("note:a", { x: 600, y: 320 });
  for (let index = 0; index < 12; index += 1) simulation.tick();

  const positions = simulation.positions();
  assert.deepEqual(positions.get("note:a"), { x: 600, y: 320 });
  assert.ok(positions.get("note:b")!.x > 305);
});

test("releases a dragged node with momentum and continues the simulation", () => {
  const simulation = new LiveForceSimulation(linkedGraph, new Map([
    ["note:a", { x: 200, y: 320 }],
    ["note:b", { x: 300, y: 320 }],
  ]));

  simulation.pin("note:a", { x: 500, y: 320 });
  simulation.movePinned("note:a", { x: 540, y: 320 });
  simulation.release("note:a");
  const frame = simulation.tick();

  assert.ok(frame.positions.get("note:a")!.x > 540);
  assert.equal(frame.active, true);
});

test("produces deterministic motion and eventually cools to rest", () => {
  const positions = new Map([
    ["note:a", { x: 200, y: 280 }],
    ["note:b", { x: 360, y: 360 }],
  ]);
  const first = new LiveForceSimulation(linkedGraph, positions);
  const second = new LiveForceSimulation(linkedGraph, positions);
  let firstFrame = first.tick();
  let secondFrame = second.tick();

  assert.deepEqual(firstFrame.positions, secondFrame.positions);
  for (let index = 0; index < 600 && firstFrame.active; index += 1) {
    firstFrame = first.tick();
    secondFrame = second.tick();
  }

  assert.equal(firstFrame.active, false);
  assert.deepEqual(firstFrame.positions, secondFrame.positions);
});
