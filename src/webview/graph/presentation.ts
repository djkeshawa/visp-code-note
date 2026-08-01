import type { GraphDataWire } from "../contracts.js";
import {
  EDGE_CLASSES,
  NODE_CLASSES,
  SELECTED,
  TAB_STOP,
  UNKNOWN_EMPHASIS,
  buildAdjacency,
  changedEmphasisBits,
  edgeEmphasisMask,
  nodeEmphasisMask,
} from "./emphasisModel.js";
import type { EmphasisInput } from "./emphasisModel.js";

const EMPTY_SET: ReadonlySet<string> = new Set();

interface CachedNode {
  readonly element: SVGGElement;
  readonly nodeId: string;
  mask: number;
}

interface CachedEdge {
  readonly element: SVGLineElement;
  readonly sourceId: string | undefined;
  readonly targetId: string | undefined;
  mask: number;
}

/**
 * Applies hover, selection, and search emphasis to the rendered graph.
 *
 * Element handles and adjacency are cached per render, and each element remembers the
 * emphasis it currently shows. A pointer moving across a large graph therefore touches
 * only the elements whose appearance actually changes, instead of re-querying the whole
 * SVG and rewriting every class on every event.
 */
export class GraphEmphasis {
  private nodes: CachedNode[] = [];
  private edges: CachedEdge[] = [];
  private adjacency: ReadonlyMap<string, ReadonlySet<string>> = new Map();

  public constructor(private readonly svg: SVGSVGElement) {}

  /** Call after the SVG is rebuilt, when cached handles and adjacency are stale. */
  public refresh(graph: GraphDataWire): void {
    this.nodes = [];
    for (const element of Array.from(this.svg.querySelectorAll<SVGGElement>(".graph-node"))) {
      const nodeId = element.dataset.nodeId;
      // Freshly rendered, so what it currently shows is not known: the next apply writes all.
      if (nodeId !== undefined) this.nodes.push({ element, nodeId, mask: UNKNOWN_EMPHASIS });
    }
    this.edges = Array.from(this.svg.querySelectorAll<SVGLineElement>(".graph-edge")).map(
      (element) => ({
        element,
        sourceId: element.dataset.sourceId,
        targetId: element.dataset.targetId,
        mask: UNKNOWN_EMPHASIS,
      }),
    );
    this.adjacency = buildAdjacency(graph);
  }

  public apply(
    graph: GraphDataWire,
    selectedId: string | undefined,
    hoveredId: string | undefined,
    matchingIds: ReadonlySet<string>,
    searchActive: boolean,
  ): void {
    const emphasisId = hoveredId ?? selectedId;
    const input: EmphasisInput = {
      selectedId,
      hoveredId,
      matchingIds,
      searchActive,
      tabStopId: selectedId ?? graph.focusId ?? graph.nodes[0]?.id,
      neighborIds: (emphasisId === undefined ? undefined : this.adjacency.get(emphasisId))
        ?? EMPTY_SET,
    };

    for (const node of this.nodes) {
      const mask = nodeEmphasisMask(node.nodeId, input);
      if (mask === node.mask) continue;
      const changed = changedEmphasisBits(mask, node.mask);
      for (const [bit, className] of NODE_CLASSES) {
        if ((changed & bit) !== 0) node.element.classList.toggle(className, (mask & bit) !== 0);
      }
      if ((changed & TAB_STOP) !== 0) {
        node.element.setAttribute("tabindex", (mask & TAB_STOP) !== 0 ? "0" : "-1");
      }
      if ((changed & SELECTED) !== 0) {
        if ((mask & SELECTED) !== 0) node.element.setAttribute("aria-current", "true");
        else node.element.removeAttribute("aria-current");
      }
      node.mask = mask;
    }

    for (const edge of this.edges) {
      const mask = edgeEmphasisMask(edge.sourceId, edge.targetId, input);
      if (mask === edge.mask) continue;
      const changed = changedEmphasisBits(mask, edge.mask);
      for (const [bit, className] of EDGE_CLASSES) {
        if ((changed & bit) !== 0) edge.element.classList.toggle(className, (mask & bit) !== 0);
      }
      edge.mask = mask;
    }
  }
}

export function focusGraphNode(svg: SVGSVGElement, nodeId: string | undefined): void {
  if (nodeId === undefined) return;
  const escaped = nodeId.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  svg.querySelector<SVGGElement>(`.graph-node[data-node-id="${escaped}"]`)?.focus();
}

export function connectionNodeIdFromTarget(target: EventTarget | null): string | undefined {
  return target instanceof Element
    ? target.closest<HTMLElement>("#selected-connections [data-node-id]")?.dataset.nodeId
    : undefined;
}

export function focusConnectionRow(container: HTMLElement, nodeId: string): boolean {
  for (const row of Array.from(container.querySelectorAll<HTMLElement>("[data-node-id]"))) {
    if (row.dataset.nodeId === nodeId) {
      row.focus();
      return true;
    }
  }
  return false;
}
