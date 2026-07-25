import type { GraphPoint } from "./layout.js";

export function dragThresholdExceeded(
  start: GraphPoint,
  current: GraphPoint,
  threshold = 4,
): boolean {
  return Math.hypot(current.x - start.x, current.y - start.y) >= threshold;
}

export function movedGraphPositions(
  positions: ReadonlyMap<string, GraphPoint>,
  nodeId: string,
  point: GraphPoint,
): ReadonlyMap<string, GraphPoint> {
  if (!positions.has(nodeId)) return positions;
  const moved = new Map(positions);
  moved.set(nodeId, point);
  return moved;
}

export function positionsWithOverrides(
  positions: ReadonlyMap<string, GraphPoint>,
  nodeIds: ReadonlySet<string>,
  overrides: ReadonlyMap<string, GraphPoint>,
): ReadonlyMap<string, GraphPoint> {
  const merged = new Map(positions);
  for (const [nodeId, point] of overrides) {
    if (nodeIds.has(nodeId)) merged.set(nodeId, point);
  }
  return merged;
}
