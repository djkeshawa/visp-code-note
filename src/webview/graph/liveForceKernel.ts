import type { GraphEdgeWire } from "../contracts.js";
import type { GraphBounds, GraphPoint } from "./layout.js";

export interface ForceNodeState {
  readonly id: string;
  readonly radius: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  pinned?: GraphPoint;
  releaseVelocity: MutablePoint;
}

export interface ForceLinkState {
  readonly source: number;
  readonly target: number;
  readonly distance: number;
}

interface MutablePoint {
  x: number;
  y: number;
}

const FULL_REPULSION_LIMIT = 140;
const REPULSION_SAMPLE_SIZE = 42;

export function createForceLinks(
  edges: readonly GraphEdgeWire[],
  indexById: ReadonlyMap<string, number>,
  idealDistance: number,
): readonly ForceLinkState[] {
  const links: ForceLinkState[] = [];
  for (const edge of edges) {
    const source = indexById.get(edge.source);
    const target = indexById.get(edge.target);
    if (source === undefined || target === undefined || source === target) continue;
    links.push({
      source,
      target,
      distance: idealDistance * (edge.kind === "link" ? 1 : 0.76),
    });
  }
  return links;
}

export function integrateLiveForces(
  nodes: ForceNodeState[],
  links: readonly ForceLinkState[],
  bounds: GraphBounds,
  idealDistance: number,
  alpha: number,
): number {
  const forces = nodes.map<MutablePoint>(() => ({ x: 0, y: 0 }));
  applyPairForces(nodes, forces, idealDistance, alpha);
  applyLinkForces(nodes, forces, links, alpha);
  return integrateNodes(nodes, forces, bounds, alpha);
}

function applyPairForces(
  nodes: readonly ForceNodeState[],
  forces: MutablePoint[],
  idealDistance: number,
  alpha: number,
): void {
  if (nodes.length <= FULL_REPULSION_LIMIT) {
    for (let left = 0; left < nodes.length; left += 1) {
      for (let right = left + 1; right < nodes.length; right += 1) {
        applyPairForce(left, right, nodes, forces, idealDistance, alpha, 1);
      }
    }
    return;
  }

  const sampleSize = Math.min(REPULSION_SAMPLE_SIZE, Math.floor((nodes.length - 1) / 2));
  const sampleScale = Math.min(4, nodes.length / Math.max(1, sampleSize * 2));
  for (let left = 0; left < nodes.length; left += 1) {
    for (let offset = 1; offset <= sampleSize; offset += 1) {
      applyPairForce(
        left,
        (left + offset) % nodes.length,
        nodes,
        forces,
        idealDistance,
        alpha,
        sampleScale,
      );
    }
  }
}

function applyPairForce(
  leftIndex: number,
  rightIndex: number,
  nodes: readonly ForceNodeState[],
  forces: MutablePoint[],
  idealDistance: number,
  alpha: number,
  scale: number,
): void {
  const left = nodes[leftIndex]!;
  const right = nodes[rightIndex]!;
  const dx = left.x - right.x || 0.01;
  const dy = left.y - right.y || (leftIndex < rightIndex ? -0.01 : 0.01);
  const distanceSquared = Math.max(25, dx * dx + dy * dy);
  const distance = Math.sqrt(distanceSquared);
  const repulsion = (idealDistance * idealDistance * 0.026 * scale * alpha) / distanceSquared;
  const minimumDistance = left.radius + right.radius + 6;
  const collision = distance < minimumDistance ? (minimumDistance - distance) * 0.11 * alpha : 0;
  const forceX = dx * repulsion + (dx / distance) * collision;
  const forceY = dy * repulsion + (dy / distance) * collision;
  forces[leftIndex]!.x += forceX;
  forces[leftIndex]!.y += forceY;
  forces[rightIndex]!.x -= forceX;
  forces[rightIndex]!.y -= forceY;
}

function applyLinkForces(
  nodes: readonly ForceNodeState[],
  forces: MutablePoint[],
  links: readonly ForceLinkState[],
  alpha: number,
): void {
  for (const link of links) {
    const source = nodes[link.source]!;
    const target = nodes[link.target]!;
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const strength = (distance - link.distance) * 0.034 * alpha;
    const forceX = (dx / distance) * strength;
    const forceY = (dy / distance) * strength;
    forces[link.source]!.x += forceX;
    forces[link.source]!.y += forceY;
    forces[link.target]!.x -= forceX;
    forces[link.target]!.y -= forceY;
  }
}

function integrateNodes(
  nodes: ForceNodeState[],
  forces: readonly MutablePoint[],
  bounds: GraphBounds,
  alpha: number,
): number {
  const center = { x: bounds.width / 2, y: bounds.height / 2 };
  const maximum = { x: bounds.width - 48, y: bounds.height - 48 };
  let maximumSpeed = 0;
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]!;
    if (node.pinned !== undefined) {
      node.x = node.pinned.x;
      node.y = node.pinned.y;
      node.vx = 0;
      node.vy = 0;
      continue;
    }
    const centerPull = 0.0035 * alpha;
    const boundaryX = boundaryForce(node.x, 48, maximum.x) * alpha;
    const boundaryY = boundaryForce(node.y, 48, maximum.y) * alpha;
    node.vx = (node.vx + forces[index]!.x + (center.x - node.x) * centerPull + boundaryX) * 0.78;
    node.vy = (node.vy + forces[index]!.y + (center.y - node.y) * centerPull + boundaryY) * 0.78;
    const speed = Math.hypot(node.vx, node.vy);
    const speedScale = speed > 11 ? 11 / speed : 1;
    node.vx *= speedScale;
    node.vy *= speedScale;
    node.x += node.vx;
    node.y += node.vy;
    maximumSpeed = Math.max(maximumSpeed, Math.hypot(node.vx, node.vy));
  }
  return maximumSpeed;
}

function boundaryForce(value: number, minimum: number, maximum: number): number {
  if (value < minimum) return (minimum - value) * 0.1;
  if (value > maximum) return (maximum - value) * 0.1;
  return 0;
}
