import type { GraphDataWire } from "../contracts.js";

/**
 * Emphasis rules for the graph canvas, kept free of DOM types so they can be reasoned
 * about and tested on their own; `presentation.ts` owns the element writes.
 *
 * State is a bitmask so a frame's worth of classes can be compared with one integer test.
 * Hovering a node changes that node and its neighbours; in a large graph everything else
 * is unchanged, and comparing masks is what lets the DOM pass skip it.
 */
export const SELECTED = 1 << 0;
const HOVERED = 1 << 1;
const EMPHASIS_SOURCE = 1 << 2;
const CONNECTED = 1 << 3;
const CONTEXT_DIMMED = 1 << 4;
const SEARCH_MATCH = 1 << 5;
const SEARCH_DIMMED = 1 << 6;
export const TAB_STOP = 1 << 7;

export const NODE_CLASSES: readonly [number, string][] = [
  [SELECTED, "is-selected"],
  [HOVERED, "is-hovered"],
  [EMPHASIS_SOURCE, "is-emphasis-source"],
  [CONNECTED, "is-connected"],
  [CONTEXT_DIMMED, "is-context-dimmed"],
  [SEARCH_MATCH, "is-search-match"],
  [SEARCH_DIMMED, "is-search-dimmed"],
];

export const EDGE_CLASSES: readonly [number, string][] = [
  [CONNECTED, "is-connected"],
  [CONTEXT_DIMMED, "is-context-dimmed"],
  [SEARCH_DIMMED, "is-search-dimmed"],
];

export interface EmphasisInput {
  readonly selectedId: string | undefined;
  readonly hoveredId: string | undefined;
  readonly matchingIds: ReadonlySet<string>;
  readonly searchActive: boolean;
  readonly tabStopId: string | undefined;
  readonly neighborIds: ReadonlySet<string>;
}

/**
 * Which classes to rewrite, given the emphasis now and the emphasis last written.
 *
 * `UNKNOWN_EMPHASIS` is what an element carries when its current classes are not known —
 * straight after the SVG is rebuilt — and it has to mean "rewrite all of them". XOR-ing
 * against it does the opposite: every bit that is *set* in the new mask comes out unchanged,
 * so the first pass after a render could only ever remove classes. Selection emphasis
 * therefore never appeared until a hover forced a second pass with a real previous mask.
 */
export const UNKNOWN_EMPHASIS = -1;

export function changedEmphasisBits(mask: number, previous: number): number {
  return previous === UNKNOWN_EMPHASIS ? ~0 : mask ^ previous;
}

export function nodeEmphasisMask(nodeId: string, input: EmphasisInput): number {
  const emphasisId = input.hoveredId ?? input.selectedId;
  const selected = nodeId === input.selectedId;
  const emphasisSource = nodeId === emphasisId;
  const connected = input.neighborIds.has(nodeId);
  const matches = input.matchingIds.has(nodeId);
  return (selected ? SELECTED : 0) |
    (nodeId === input.hoveredId ? HOVERED : 0) |
    (emphasisSource ? EMPHASIS_SOURCE : 0) |
    (connected ? CONNECTED : 0) |
    (emphasisId !== undefined && !emphasisSource && !connected && !selected ? CONTEXT_DIMMED : 0) |
    (input.searchActive && matches ? SEARCH_MATCH : 0) |
    (input.searchActive && !matches ? SEARCH_DIMMED : 0) |
    (nodeId === input.tabStopId ? TAB_STOP : 0);
}

export function edgeEmphasisMask(
  sourceId: string | undefined,
  targetId: string | undefined,
  input: EmphasisInput,
): number {
  const emphasisId = input.hoveredId ?? input.selectedId;
  const connected = emphasisId !== undefined &&
    (sourceId === emphasisId || targetId === emphasisId);
  const matches = (sourceId !== undefined && input.matchingIds.has(sourceId)) ||
    (targetId !== undefined && input.matchingIds.has(targetId));
  return (connected ? CONNECTED : 0) |
    (emphasisId !== undefined && !connected ? CONTEXT_DIMMED : 0) |
    (input.searchActive && !matches ? SEARCH_DIMMED : 0);
}

/**
 * Neighbour sets for every node, built once per render. The previous code rescanned every
 * edge on each hover to find one node's neighbours.
 */
export function buildAdjacency(graph: GraphDataWire): ReadonlyMap<string, ReadonlySet<string>> {
  const adjacency = new Map<string, Set<string>>();
  const connect = (from: string, to: string): void => {
    let neighbors = adjacency.get(from);
    if (neighbors === undefined) {
      neighbors = new Set<string>();
      adjacency.set(from, neighbors);
    }
    neighbors.add(to);
  };
  for (const edge of graph.edges) {
    if (edge.source === edge.target) continue;
    connect(edge.source, edge.target);
    connect(edge.target, edge.source);
  }
  return adjacency;
}
