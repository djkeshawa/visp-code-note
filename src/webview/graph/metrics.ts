import type { GraphDataWire, GraphNodeWire } from "../contracts.js";

export function nodeDegrees(graph: GraphDataWire): ReadonlyMap<string, number> {
  const degrees = new Map(graph.nodes.map((node) => [node.id, 0]));
  for (const edge of graph.edges) {
    if (edge.source === edge.target) continue;
    if (degrees.has(edge.source)) degrees.set(edge.source, (degrees.get(edge.source) ?? 0) + 1);
    if (degrees.has(edge.target)) degrees.set(edge.target, (degrees.get(edge.target) ?? 0) + 1);
  }
  return degrees;
}

export function nodeRadius(node: GraphNodeWire, degree: number, focused: boolean): number {
  const baseRadius = node.kind === "note" ? 5.5 : node.kind === "task" ? 5 : 4.5;
  const connectionGrowth = Math.min(7, Math.log2(degree + 1) * 2.1);
  const radius = baseRadius + connectionGrowth;
  return focused ? Math.max(12, radius) : radius;
}

export function nodeHitRadius(radius: number): number {
  return Math.max(20, radius + 7);
}

export function isHubNode(degree: number): boolean {
  return degree >= 4;
}
