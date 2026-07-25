import assert = require("node:assert/strict");
import { test } from "node:test";
import { findSpatialNodeId } from "../../src/webview/graph/spatialNavigation";

const positions = new Map([
  ["center", { x: 100, y: 100 }],
  ["right-near", { x: 140, y: 112 }],
  ["right-far", { x: 190, y: 100 }],
  ["left", { x: 20, y: 105 }],
  ["up", { x: 102, y: 20 }],
  ["down", { x: 98, y: 180 }],
]);

test("chooses the nearest directionally aligned node for each arrow key", () => {
  assert.equal(findSpatialNodeId(positions, "center", "ArrowRight"), "right-near");
  assert.equal(findSpatialNodeId(positions, "center", "ArrowLeft"), "left");
  assert.equal(findSpatialNodeId(positions, "center", "ArrowUp"), "up");
  assert.equal(findSpatialNodeId(positions, "center", "ArrowDown"), "down");
});

test("does not wrap spatial navigation or handle unrelated keys", () => {
  assert.equal(findSpatialNodeId(positions, "right-far", "ArrowRight"), undefined);
  assert.equal(findSpatialNodeId(positions, "missing", "ArrowLeft"), undefined);
  assert.equal(findSpatialNodeId(positions, "center", "Home"), undefined);
});
