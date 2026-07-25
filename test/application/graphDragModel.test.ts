import assert = require("node:assert/strict");
import { test } from "node:test";
import {
  dragThresholdExceeded,
  movedGraphPositions,
  positionsWithOverrides,
} from "../../src/webview/graph/dragModel";
import {
  beginPointerCapture,
  endPointerCapture,
} from "../../src/webview/graph/pointerCapture";

test("starts a node drag only after a deliberate pointer movement", () => {
  assert.equal(dragThresholdExceeded({ x: 10, y: 10 }, { x: 12, y: 12 }), false);
  assert.equal(dragThresholdExceeded({ x: 10, y: 10 }, { x: 14, y: 10 }), true);
});

test("releases pointer capture from the node that began the gesture", () => {
  const calls: string[] = [];
  const captured = new Set<number>();
  const node = {
    setPointerCapture(pointerId: number): void {
      captured.add(pointerId);
      calls.push(`capture:${pointerId}`);
    },
    hasPointerCapture(pointerId: number): boolean {
      return captured.has(pointerId);
    },
    releasePointerCapture(pointerId: number): void {
      captured.delete(pointerId);
      calls.push(`release:${pointerId}`);
    },
  };

  const gesture = beginPointerCapture(node, 7);
  endPointerCapture(gesture);

  assert.deepEqual(calls, ["capture:7", "release:7"]);
  assert.equal(captured.size, 0);
});

test("tolerates pointer capture ending before gesture cleanup", () => {
  let releases = 0;
  const node = {
    setPointerCapture(): void {},
    hasPointerCapture(): boolean {
      return false;
    },
    releasePointerCapture(): void {
      releases += 1;
    },
  };

  endPointerCapture(beginPointerCapture(node, 4));

  assert.equal(releases, 0);
});

test("moves one node without mutating the current rendered positions", () => {
  const positions = new Map([
    ["note:a", { x: 100, y: 100 }],
    ["note:b", { x: 200, y: 200 }],
  ]);

  const moved = movedGraphPositions(positions, "note:a", { x: 160, y: 140 });

  assert.deepEqual(moved.get("note:a"), { x: 160, y: 140 });
  assert.deepEqual(moved.get("note:b"), { x: 200, y: 200 });
  assert.deepEqual(positions.get("note:a"), { x: 100, y: 100 });
});

test("retains overrides only for nodes still visible in the graph", () => {
  const automatic = new Map([
    ["note:a", { x: 100, y: 100 }],
    ["note:b", { x: 200, y: 200 }],
  ]);
  const overrides = new Map([
    ["note:a", { x: 130, y: 120 }],
    ["note:removed", { x: 500, y: 500 }],
  ]);

  const merged = positionsWithOverrides(automatic, new Set(automatic.keys()), overrides);

  assert.deepEqual([...merged.entries()], [
    ["note:a", { x: 130, y: 120 }],
    ["note:b", { x: 200, y: 200 }],
  ]);
});
