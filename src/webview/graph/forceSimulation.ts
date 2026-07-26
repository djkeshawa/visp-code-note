import type { GraphDataWire, GraphEdgeWire } from "../contracts.js";
import { BarnesHutField } from "./barnesHut.js";
import type { RepulsionSettings } from "./barnesHut.js";
import type { GraphBounds, GraphPoint } from "./layout.js";

const PADDING = 56;

/**
 * The settle pass shares the live simulation's quadtree repulsion, so the opening layout
 * and every later frame agree about which nodes push on which. Collision separation is off
 * here because radii are not known at settle time; the live pass takes over that job.
 */
const REPULSION: RepulsionSettings = { strength: 0.04, collisionStrength: 0, theta: 1.5 };

export function settleGraphLayout(
  graph: GraphDataWire,
  initial: ReadonlyMap<string, GraphPoint>,
  bounds: GraphBounds,
): ReadonlyMap<string, GraphPoint> {
  const ids = [...initial.keys()].sort((left, right) => hash(left) - hash(right));
  const indexById = new Map(ids.map((id, index) => [id, index]));
  const count = ids.length;
  const x = new Float64Array(count);
  const y = new Float64Array(count);
  const vx = new Float64Array(count);
  const vy = new Float64Array(count);
  const forceX = new Float64Array(count);
  const forceY = new Float64Array(count);
  // Repulsion here is positional only, so a uniform placeholder radius is enough.
  const radius = new Float64Array(count).fill(1);
  for (const [index, id] of ids.entries()) {
    const point = initial.get(id)!;
    x[index] = point.x;
    y[index] = point.y;
  }

  const edges = graph.edges.filter((edge) => edge.source !== edge.target);
  const idealDistance = clamp(
    Math.sqrt((bounds.width * bounds.height) / Math.max(1, count)) * 0.66,
    48,
    104,
  );
  // The settle pass only has to place nodes roughly right: the live simulation refines
  // from here, and for callers that cannot animate, GraphMotionController settles
  // synchronously instead. So a large graph spends its budget on the live pass, where
  // quadtree repulsion converges, rather than on many expensive opening iterations.
  const iterations = count <= 60 ? 90 : 34;
  const field = new BarnesHutField(count);
  const focusIndex = graph.focusId === undefined ? -1 : indexById.get(graph.focusId) ?? -1;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    forceX.fill(0);
    forceY.fill(0);
    field.build(x, y, count);
    for (let index = 0; index < count; index += 1) {
      field.accumulate(index, x, y, radius, forceX, forceY, idealDistance, 1, REPULSION);
    }
    applyLinks(edges, indexById, x, y, forceX, forceY, idealDistance);
    integrate(x, y, vx, vy, forceX, forceY, focusIndex, bounds, iteration / iterations);
  }

  return new Map(ids.map((id, index) => [id, roundPoint(x[index]!, y[index]!)]));
}

function applyLinks(
  edges: readonly GraphEdgeWire[],
  indexById: ReadonlyMap<string, number>,
  x: Float64Array,
  y: Float64Array,
  forceX: Float64Array,
  forceY: Float64Array,
  idealDistance: number,
): void {
  for (const edge of edges) {
    const from = indexById.get(edge.source);
    const to = indexById.get(edge.target);
    if (from === undefined || to === undefined) continue;
    const dx = x[to]! - x[from]!;
    const dy = y[to]! - y[from]!;
    const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
    const targetDistance = idealDistance * (edge.kind === "link" ? 1 : 0.76);
    const strength = (distance - targetDistance) * 0.045;
    const pushX = (dx / distance) * strength;
    const pushY = (dy / distance) * strength;
    forceX[from] = forceX[from]! + pushX;
    forceY[from] = forceY[from]! + pushY;
    forceX[to] = forceX[to]! - pushX;
    forceY[to] = forceY[to]! - pushY;
  }
}

function integrate(
  x: Float64Array,
  y: Float64Array,
  vx: Float64Array,
  vy: Float64Array,
  forceX: Float64Array,
  forceY: Float64Array,
  focusIndex: number,
  bounds: GraphBounds,
  progress: number,
): void {
  const centerX = bounds.width / 2;
  const centerY = bounds.height / 2;
  const maxSpeed = 8 - progress * 6;
  const maximumX = bounds.width - PADDING;
  const maximumY = bounds.height - PADDING;
  const centerPull = 0.025;
  for (let index = 0; index < x.length; index += 1) {
    if (index === focusIndex) {
      x[index] = centerX;
      y[index] = centerY;
      vx[index] = 0;
      vy[index] = 0;
      continue;
    }
    const boundaryX = boundaryForce(x[index]!, PADDING, maximumX);
    const boundaryY = boundaryForce(y[index]!, PADDING, maximumY);
    const nextVX = (vx[index]! + forceX[index]! + (centerX - x[index]!) * centerPull + boundaryX) *
      0.72;
    const nextVY = (vy[index]! + forceY[index]! + (centerY - y[index]!) * centerPull + boundaryY) *
      0.72;
    vx[index] = nextVX;
    vy[index] = nextVY;
    const speed = Math.max(1, Math.sqrt(nextVX * nextVX + nextVY * nextVY));
    const scale = Math.min(1, maxSpeed / speed);
    x[index] = x[index]! + nextVX * scale;
    y[index] = y[index]! + nextVY * scale;
  }
}

function boundaryForce(value: number, minimum: number, maximum: number): number {
  if (value < minimum) return (minimum - value) * 0.12;
  if (value > maximum) return (maximum - value) * 0.12;
  return 0;
}

function hash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result = Math.imul(result ^ value.charCodeAt(index), 16777619);
  }
  return result >>> 0;
}

function roundPoint(x: number, y: number): GraphPoint {
  return { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
