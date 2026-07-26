import assert = require("node:assert/strict");
import { test } from "node:test";
import { BarnesHutField } from "../../src/webview/graph/barnesHut";
import type { RepulsionSettings } from "../../src/webview/graph/barnesHut";

const SETTINGS: RepulsionSettings = { strength: 0.026, collisionStrength: 0.11 };
const IDEAL = 80;
const ALPHA = 0.5;

interface Layout {
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly radius: Float64Array;
}

function layout(points: readonly [number, number][], radius = 10): Layout {
  return {
    x: Float64Array.from(points.map(([px]) => px)),
    y: Float64Array.from(points.map(([, py]) => py)),
    radius: Float64Array.from(points.map(() => radius)),
  };
}

/** The definition the quadtree approximates: every node against every other node. */
function bruteForce(
  { x, y, radius }: Layout,
  settings: RepulsionSettings = SETTINGS,
): { forceX: Float64Array; forceY: Float64Array } {
  const count = x.length;
  const forceX = new Float64Array(count);
  const forceY = new Float64Array(count);
  const repulsionScale = IDEAL * IDEAL * settings.strength * ALPHA;
  const collisionStrength = settings.collisionStrength * ALPHA;
  for (let index = 0; index < count; index += 1) {
    for (let other = 0; other < count; other += 1) {
      if (index === other) continue;
      let dx = x[index]! - x[other]!;
      let dy = y[index]! - y[other]!;
      if (dx === 0 && dy === 0) {
        dx = index < other ? 0.01 : -0.01;
        dy = index < other ? -0.01 : 0.01;
      }
      const distanceSquared = Math.max(25, dx * dx + dy * dy);
      const distance = Math.sqrt(distanceSquared);
      const repulsion = repulsionScale / distanceSquared;
      const separation = radius[index]! + radius[other]!;
      const overlap = distance < separation ? (separation - distance) * collisionStrength : 0;
      forceX[index] = forceX[index]! + dx * repulsion + (dx / distance) * overlap;
      forceY[index] = forceY[index]! + dy * repulsion + (dy / distance) * overlap;
    }
  }
  return { forceX, forceY };
}

function quadtree(
  input: Layout,
  settings: RepulsionSettings = SETTINGS,
): { forceX: Float64Array; forceY: Float64Array } {
  const count = input.x.length;
  const field = new BarnesHutField(count);
  field.build(input.x, input.y, count);
  const forceX = new Float64Array(count);
  const forceY = new Float64Array(count);
  for (let index = 0; index < count; index += 1) {
    field.accumulate(
      index,
      input.x,
      input.y,
      input.radius,
      forceX,
      forceY,
      IDEAL,
      ALPHA,
      settings,
    );
  }
  return { forceX, forceY };
}

function grid(size: number, spacing: number): Layout {
  const points: [number, number][] = [];
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      points.push([column * spacing + (row % 2) * 3, row * spacing]);
    }
  }
  return layout(points);
}

test("a graph that fits in one leaf matches brute force exactly", () => {
  const input = layout([[0, 0], [40, 0], [0, 40], [40, 40]]);

  const exact = bruteForce(input);
  const approximate = quadtree(input);

  for (let index = 0; index < input.x.length; index += 1) {
    assert.ok(Math.abs(exact.forceX[index]! - approximate.forceX[index]!) < 1e-12);
    assert.ok(Math.abs(exact.forceY[index]! - approximate.forceY[index]!) < 1e-12);
  }
});

test("a near-zero theta reproduces brute force across a large grid", () => {
  const input = grid(12, 30);

  const exact = bruteForce(input);
  const approximate = quadtree(input, { ...SETTINGS, theta: 0.001 });

  let worst = 0;
  for (let index = 0; index < input.x.length; index += 1) {
    worst = Math.max(
      worst,
      Math.abs(exact.forceX[index]! - approximate.forceX[index]!),
      Math.abs(exact.forceY[index]! - approximate.forceY[index]!),
    );
  }
  assert.ok(worst < 1e-9, `worst deviation ${worst}`);
});

test("the default theta stays close to brute force and never flips direction", () => {
  const input = grid(14, 26);

  const exact = bruteForce(input);
  const approximate = quadtree(input);

  let worstRelative = 0;
  for (let index = 0; index < input.x.length; index += 1) {
    const exactMagnitude = Math.hypot(exact.forceX[index]!, exact.forceY[index]!);
    const deviation = Math.hypot(
      exact.forceX[index]! - approximate.forceX[index]!,
      exact.forceY[index]! - approximate.forceY[index]!,
    );
    if (exactMagnitude > 1e-6) {
      worstRelative = Math.max(worstRelative, deviation / exactMagnitude);
      const dot = exact.forceX[index]! * approximate.forceX[index]! +
        exact.forceY[index]! * approximate.forceY[index]!;
      assert.ok(dot > 0, `force at ${index} reversed direction`);
    }
  }
  assert.ok(worstRelative < 0.35, `worst relative deviation ${worstRelative}`);
});

test("an outlying node is pushed away from a distant cluster", () => {
  const input = layout([
    [500, 300], [510, 305], [505, 295], [495, 310], [515, 292], [498, 301],
    [900, 300],
  ]);

  const { forceX, forceY } = quadtree(input);

  const outlier = input.x.length - 1;
  assert.ok(forceX[outlier]! > 0, "outlier should be pushed further right");
  assert.ok(Math.abs(forceY[outlier]!) < Math.abs(forceX[outlier]!));
});

test("coincident nodes separate instead of staying stacked", () => {
  const input = layout([[300, 300], [300, 300], [300, 300]]);

  const { forceX, forceY } = quadtree(input);

  for (let index = 0; index < input.x.length; index += 1) {
    assert.ok(
      Math.hypot(forceX[index]!, forceY[index]!) > 0,
      `node ${index} received no separating force`,
    );
  }
});

test("overlapping nodes get a collision push the inverse-square term alone would not give", () => {
  const touching = layout([[300, 300], [312, 300]], 10);

  const withCollision = quadtree(touching);
  const withoutCollision = quadtree(touching, { ...SETTINGS, collisionStrength: 0 });

  assert.ok(withCollision.forceX[1]! > withoutCollision.forceX[1]!);
});

test("an empty graph produces no forces and does not throw", () => {
  const field = new BarnesHutField(0);
  field.build(new Float64Array(0), new Float64Array(0), 0);
  const forceX = new Float64Array(1);

  field.accumulate(0, new Float64Array(1), new Float64Array(1), new Float64Array(1),
    forceX, new Float64Array(1), IDEAL, ALPHA, SETTINGS);

  assert.equal(forceX[0], 0);
});
