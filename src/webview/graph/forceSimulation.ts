import type { GraphDataWire, GraphEdgeWire } from "../contracts.js";
import type { GraphBounds, GraphPoint } from "./layout.js";

interface NodeState {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface Force {
  x: number;
  y: number;
}

const PADDING = 56;
const FULL_REPULSION_LIMIT = 160;
const REPULSION_SAMPLE_SIZE = 48;

export function settleGraphLayout(
  graph: GraphDataWire,
  initial: ReadonlyMap<string, GraphPoint>,
  bounds: GraphBounds,
): ReadonlyMap<string, GraphPoint> {
  const ids = [...initial.keys()].sort((left, right) => hash(left) - hash(right));
  const indexById = new Map(ids.map((id, index) => [id, index]));
  const states = ids.map((id) => ({ ...initial.get(id)!, vx: 0, vy: 0 }));
  const edges = graph.edges.filter((edge) => edge.source !== edge.target);
  const idealDistance = clamp(Math.sqrt((bounds.width * bounds.height) / states.length) * 0.66, 48, 104);
  const iterations = states.length <= 60 ? 90 : states.length <= FULL_REPULSION_LIMIT ? 68 : 44;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const forces = states.map<Force>(() => ({ x: 0, y: 0 }));
    applyRepulsion(states, forces, idealDistance);
    applyLinks(edges, indexById, states, forces, idealDistance);
    integrate(ids, states, forces, graph.focusId, bounds, iteration / iterations);
  }

  return new Map(ids.map((id, index) => [id, roundPoint(states[index]!) ]));
}

function applyRepulsion(states: readonly NodeState[], forces: Force[], idealDistance: number): void {
  if (states.length <= FULL_REPULSION_LIMIT) {
    for (let left = 0; left < states.length; left += 1) {
      for (let right = left + 1; right < states.length; right += 1) {
        repelPair(left, right, states, forces, idealDistance, 1);
      }
    }
    return;
  }

  const sampleSize = Math.min(REPULSION_SAMPLE_SIZE, Math.floor((states.length - 1) / 2));
  const sampleScale = Math.min(4, states.length / Math.max(1, sampleSize * 2));
  for (let left = 0; left < states.length; left += 1) {
    for (let offset = 1; offset <= sampleSize; offset += 1) {
      repelPair(left, (left + offset) % states.length, states, forces, idealDistance, sampleScale);
    }
  }
}

function repelPair(
  left: number,
  right: number,
  states: readonly NodeState[],
  forces: Force[],
  idealDistance: number,
  scale: number,
): void {
  const dx = states[left]!.x - states[right]!.x || 0.01;
  const dy = states[left]!.y - states[right]!.y || 0.01;
  const distanceSquared = Math.max(36, dx * dx + dy * dy);
  const strength = (idealDistance * idealDistance * scale * 0.04) / distanceSquared;
  const forceX = dx * strength;
  const forceY = dy * strength;
  forces[left]!.x += forceX;
  forces[left]!.y += forceY;
  forces[right]!.x -= forceX;
  forces[right]!.y -= forceY;
}

function applyLinks(
  edges: readonly GraphEdgeWire[],
  indexById: ReadonlyMap<string, number>,
  states: readonly NodeState[],
  forces: Force[],
  idealDistance: number,
): void {
  for (const edge of edges) {
    const sourceIndex = indexById.get(edge.source);
    const targetIndex = indexById.get(edge.target);
    if (sourceIndex === undefined || targetIndex === undefined) continue;
    const dx = states[targetIndex]!.x - states[sourceIndex]!.x;
    const dy = states[targetIndex]!.y - states[sourceIndex]!.y;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const targetDistance = idealDistance * (edge.kind === "link" ? 1 : 0.76);
    const strength = (distance - targetDistance) * 0.045;
    const forceX = (dx / distance) * strength;
    const forceY = (dy / distance) * strength;
    forces[sourceIndex]!.x += forceX;
    forces[sourceIndex]!.y += forceY;
    forces[targetIndex]!.x -= forceX;
    forces[targetIndex]!.y -= forceY;
  }
}

function integrate(
  ids: readonly string[],
  states: NodeState[],
  forces: readonly Force[],
  focusId: string | undefined,
  bounds: GraphBounds,
  progress: number,
): void {
  const center = { x: bounds.width / 2, y: bounds.height / 2 };
  const maxSpeed = 8 - progress * 6;
  const maximum = { x: bounds.width - PADDING, y: bounds.height - PADDING };
  for (let index = 0; index < states.length; index += 1) {
    const state = states[index]!;
    if (ids[index] === focusId) {
      Object.assign(state, center, { vx: 0, vy: 0 });
      continue;
    }
    const centerPull = 0.025;
    const boundaryX = boundaryForce(state.x, PADDING, maximum.x);
    const boundaryY = boundaryForce(state.y, PADDING, maximum.y);
    state.vx = (
      state.vx + forces[index]!.x + (center.x - state.x) * centerPull + boundaryX
    ) * 0.72;
    state.vy = (
      state.vy + forces[index]!.y + (center.y - state.y) * centerPull + boundaryY
    ) * 0.72;
    const speed = Math.max(1, Math.hypot(state.vx, state.vy));
    const scale = Math.min(1, maxSpeed / speed);
    state.x += state.vx * scale;
    state.y += state.vy * scale;
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

function roundPoint(point: GraphPoint): GraphPoint {
  return { x: Math.round(point.x * 100) / 100, y: Math.round(point.y * 100) / 100 };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
