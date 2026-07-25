import assert = require("node:assert/strict");
import { test } from "node:test";
import {
  DEFAULT_GRAPH_VIEWPORT,
  centerViewport,
  fitViewport,
  panViewport,
  zoomViewport,
} from "../../src/webview/graph/viewportModel";

test("zooms around an anchor without moving its relative screen position", () => {
  const anchor = { x: 240, y: 160 };
  const zoomed = zoomViewport(DEFAULT_GRAPH_VIEWPORT, anchor, 2);

  assert.equal(zoomed.width, 480);
  assert.equal(zoomed.height, 320);
  assert.equal((anchor.x - zoomed.x) / zoomed.width, 0.25);
  assert.equal((anchor.y - zoomed.y) / zoomed.height, 0.25);
});

test("clamps extreme zoom and ignores invalid factors", () => {
  const zoomedIn = zoomViewport(DEFAULT_GRAPH_VIEWPORT, { x: 480, y: 320 }, 1_000);
  const zoomedOut = zoomViewport(DEFAULT_GRAPH_VIEWPORT, { x: 480, y: 320 }, 0.0001);

  assert.equal(zoomedIn.width, 120);
  assert.equal(zoomedOut.width, 7_680);
  assert.equal(zoomViewport(DEFAULT_GRAPH_VIEWPORT, { x: 0, y: 0 }, 0), DEFAULT_GRAPH_VIEWPORT);
});

test("fits extents at the requested aspect ratio with padding", () => {
  const viewport = fitViewport({ minX: 100, minY: 200, maxX: 500, maxY: 400 }, 2, 20);

  assert.equal(viewport.width / viewport.height, 2);
  assert.ok(viewport.x <= 80);
  assert.ok(viewport.y <= 180);
  assert.ok(viewport.x + viewport.width >= 520);
  assert.ok(viewport.y + viewport.height >= 420);
});

test("pans and centers without changing zoom", () => {
  const panned = panViewport(DEFAULT_GRAPH_VIEWPORT, { x: 20, y: -30 });
  const centered = centerViewport(panned, { x: 100, y: 200 });

  assert.deepEqual(panned, { x: 20, y: -30, width: 960, height: 640 });
  assert.deepEqual(centered, { x: -380, y: -120, width: 960, height: 640 });
});
