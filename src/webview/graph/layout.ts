import type { GraphDataWire } from "../contracts.js";
import { settleGraphLayout } from "./forceSimulation.js";

export interface GraphPoint {
  readonly x: number;
  readonly y: number;
}

export interface GraphBounds {
  readonly width: number;
  readonly height: number;
}

const BASE_BOUNDS: GraphBounds = { width: 960, height: 640 };

/**
 * Space each node wants to itself. Node radii reach roughly 17px, so this leaves a clear
 * gap between neighbours once the layout settles.
 */
const NODE_SPACING = 64;

/**
 * Grows the layout area with the node count.
 *
 * The canvas used to be a fixed 960x640 whatever the workspace size, and a few thousand
 * nodes simply do not fit: the area needed exceeds what is available, so repulsion and the
 * boundary force fight each other and nodes overlap no matter how good the algorithm is.
 * The viewport already pans and zooms, and Fit frames whatever it is given, so a larger
 * world costs nothing on screen.
 */
export function graphLayoutBounds(
  nodeCount: number,
  base: GraphBounds = BASE_BOUNDS,
): GraphBounds {
  const baseArea = base.width * base.height;
  const required = Math.max(1, nodeCount) * NODE_SPACING * NODE_SPACING;
  if (required <= baseArea) return base;
  const scale = Math.sqrt(required / baseArea);
  return {
    width: Math.round(base.width * scale),
    height: Math.round(base.height * scale),
  };
}

export function layoutGraph(
  graph: GraphDataWire,
  bounds: GraphBounds = graphLayoutBounds(graph.nodes.length),
): ReadonlyMap<string, GraphPoint> {
  if (graph.nodes.length === 0) return new Map();
  const center = { x: bounds.width / 2, y: bounds.height / 2 };
  if (graph.nodes.length === 1 && graph.nodes[0] !== undefined) {
    return new Map([[graph.nodes[0].id, center]]);
  }
  return settleGraphLayout(graph, initialPositions(graph, bounds), bounds);
}

function initialPositions(graph: GraphDataWire, bounds: GraphBounds): ReadonlyMap<string, GraphPoint> {
  const positions = new Map<string, GraphPoint>();
  const center = { x: bounds.width / 2, y: bounds.height / 2 };
  const nodes = [...graph.nodes].sort((left, right) => left.id.localeCompare(right.id));
  const remaining = nodes.filter((node) => node.id !== graph.focusId);
  if (nodes.some((node) => node.id === graph.focusId)) positions.set(graph.focusId!, center);

  const horizontalRadius = Math.max(1, bounds.width / 2 - 110) * 0.78;
  const verticalRadius = Math.max(1, bounds.height / 2 - 90) * 0.78;
  remaining.forEach((node, index) => {
    const progress = Math.sqrt((index + 1) / Math.max(1, remaining.length));
    const angle = index * Math.PI * (3 - Math.sqrt(5)) + idAngle(node.id);
    positions.set(node.id, {
      x: center.x + Math.cos(angle) * horizontalRadius * progress,
      y: center.y + Math.sin(angle) * verticalRadius * progress,
    });
  });
  return positions;
}

function idAngle(id: string): number {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = Math.imul(31, hash) + id.charCodeAt(index);
  }
  return ((hash >>> 0) % 628) / 1000;
}
