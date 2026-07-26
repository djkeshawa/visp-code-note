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

/**
 * Below this many nodes every node keeps a label; the canvas has room for them.
 */
export const LABEL_DENSITY_LIMIT = 18;

/**
 * How many labels a crowded graph is allowed to show at rest.
 *
 * An absolute "is this a hub" test does not work here: in a real workspace graph most
 * notes have several links, so a fixed degree threshold still labelled over half the
 * canvas. Ranking by degree and taking a fixed budget keeps the label count constant
 * however large the workspace grows.
 */
export const STANDING_LABEL_BUDGET = 36;

/**
 * The nodes that keep a label without interaction: the most connected ones, which are the
 * landmarks people navigate by. Ties break on id so the choice is stable across renders.
 */
export function standingLabelIds(
  graph: GraphDataWire,
  degrees: ReadonlyMap<string, number>,
): ReadonlySet<string> {
  if (graph.nodes.length <= LABEL_DENSITY_LIMIT) {
    return new Set(graph.nodes.map((node) => node.id));
  }
  const ranked = [...graph.nodes]
    .sort((left, right) =>
      (degrees.get(right.id) ?? 0) - (degrees.get(left.id) ?? 0) ||
      left.id.localeCompare(right.id))
    .slice(0, STANDING_LABEL_BUDGET)
    // A node with no visible connections is not a landmark.
    .filter((node) => (degrees.get(node.id) ?? 0) > 0);
  return new Set(ranked.map((node) => node.id));
}
