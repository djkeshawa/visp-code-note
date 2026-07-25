import type { GraphDataWire } from "../contracts.js";

export function applyGraphEmphasis(
  svg: SVGSVGElement,
  graph: GraphDataWire,
  selectedId: string | undefined,
  hoveredId: string | undefined,
  matchingIds: ReadonlySet<string>,
  searchActive: boolean,
): void {
  const emphasisId = hoveredId ?? selectedId;
  const tabStopId = selectedId ?? graph.focusId ?? graph.nodes[0]?.id;
  const neighborIds = emphasisId === undefined ? new Set<string>() : findNeighbors(graph, emphasisId);
  for (const element of Array.from(svg.querySelectorAll<SVGGElement>(".graph-node"))) {
    const nodeId = element.dataset.nodeId;
    const selected = nodeId === selectedId;
    const hovered = nodeId === hoveredId;
    const emphasisSource = nodeId === emphasisId;
    const connected = nodeId !== undefined && neighborIds.has(nodeId);
    const matches = nodeId !== undefined && matchingIds.has(nodeId);
    element.classList.toggle("is-selected", selected);
    element.classList.toggle("is-hovered", hovered);
    element.classList.toggle("is-emphasis-source", emphasisSource);
    element.classList.toggle("is-connected", connected);
    element.classList.toggle(
      "is-context-dimmed",
      emphasisId !== undefined && !emphasisSource && !connected && !selected,
    );
    element.classList.toggle("is-search-match", searchActive && matches);
    element.classList.toggle("is-search-dimmed", searchActive && !matches);
    element.setAttribute("tabindex", nodeId === tabStopId ? "0" : "-1");
    if (selected) element.setAttribute("aria-current", "true");
    else element.removeAttribute("aria-current");
  }
  for (const edge of Array.from(svg.querySelectorAll<SVGLineElement>(".graph-edge"))) {
    const source = edge.dataset.sourceId;
    const target = edge.dataset.targetId;
    const connected = emphasisId !== undefined && (source === emphasisId || target === emphasisId);
    const matches = (source !== undefined && matchingIds.has(source))
      || (target !== undefined && matchingIds.has(target));
    edge.classList.toggle("is-connected", connected);
    edge.classList.toggle("is-context-dimmed", emphasisId !== undefined && !connected);
    edge.classList.toggle("is-search-dimmed", searchActive && !matches);
  }
}

export function focusGraphNode(svg: SVGSVGElement, nodeId: string | undefined): void {
  if (nodeId === undefined) return;
  for (const element of Array.from(svg.querySelectorAll<SVGGElement>(".graph-node"))) {
    if (element.dataset.nodeId === nodeId) {
      element.focus();
      return;
    }
  }
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

function findNeighbors(graph: GraphDataWire, selectedId: string): Set<string> {
  const neighbors = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.source === selectedId) neighbors.add(edge.target);
    if (edge.target === selectedId) neighbors.add(edge.source);
  }
  neighbors.delete(selectedId);
  return neighbors;
}
