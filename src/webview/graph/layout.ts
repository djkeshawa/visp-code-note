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

export function layoutGraph(
  graph: GraphDataWire,
  bounds: GraphBounds = { width: 960, height: 640 },
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
