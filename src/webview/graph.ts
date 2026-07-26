import type {
  GraphDataWire,
  GraphNodeKindWire,
  GraphNodeWire,
  GraphToHostWire,
} from "./contracts.js";
import { isRecord } from "./shared/dom.js";
import { acquireMessageSender } from "./shared/vscodeApi.js";
import { renderGraphDetails } from "./graph/details.js";
import {
  cycleNodeId,
  filterGraph,
  findMatchingNodeIds,
  keyboardNodeId,
  resolveSelection,
} from "./graph/interactionModel.js";
import {
  GraphEmphasis,
  connectionNodeIdFromTarget,
  focusConnectionRow,
  focusGraphNode,
} from "./graph/presentation.js";
import { getGraphPageElements } from "./graph/pageElements.js";
import { GraphMotionController } from "./graph/motionController.js";
import type { RenderedGraph } from "./graph/renderer.js";
import { findSpatialNodeId } from "./graph/spatialNavigation.js";
import { isGraphData, isGraphDepth } from "./graph/validation.js";
import { GraphViewportController } from "./graph/viewportController.js";

const api = acquireMessageSender<GraphToHostWire>();
const {
  svg, emptyState, graphScope, depthControl, search, searchStatus, orphanToggle,
  connections, zoomIn, zoomOut, fitGraph, centerSelected, zoomStatus,
  resetLayout, kindToggles, depthButtons, details,
} = getGraphPageElements();
const openSelected = details.openButton;

let graph: GraphDataWire = { nodes: [], edges: [] };
let visibleGraph: GraphDataWire = graph;
/** Node lookup by id, so hover and selection do not scan the node list. */
let visibleNodesById: ReadonlyMap<string, GraphNodeWire> = new Map();
let renderedGraph: RenderedGraph = { positions: new Map() };
let selectedId: string | undefined;
let hoveredId: string | undefined;
let matchingIds: readonly string[] = [];
let matchingIdSet: ReadonlySet<string> = new Set();
let scopeKey: string | undefined;
let fitPending = true;

const viewport = new GraphViewportController(svg, (percent) => {
  zoomStatus.textContent = `${percent}%`;
});
const emphasis = new GraphEmphasis(svg);
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const motion = new GraphMotionController(svg, updateRenderedGraph, () => !reducedMotion.matches);

search.addEventListener("input", updateSearch);
search.addEventListener("keydown", handleSearchKeydown);
orphanToggle.addEventListener("change", refreshVisibleGraph);
kindToggles.forEach((toggle) => toggle.addEventListener("change", refreshVisibleGraph));
depthButtons.forEach((button) => button.addEventListener("click", () => selectDepth(button)));
svg.addEventListener("click", handleNodeSelection);
svg.addEventListener("dblclick", handleNodeOpen);
svg.addEventListener("keydown", handleNodeKeydown);
svg.addEventListener("pointerover", handleNodePointerOver);
svg.addEventListener("pointerout", handleNodePointerOut);
connections.addEventListener("click", handleConnectionSelection);
openSelected.addEventListener("click", openSelectedNode);
zoomIn.addEventListener("click", () => viewport.zoomBy(1.25));
zoomOut.addEventListener("click", () => viewport.zoomBy(0.8));
fitGraph.addEventListener("click", fitVisibleGraph);
centerSelected.addEventListener("click", centerSelectedNode);
resetLayout.addEventListener("click", resetNodeLayout);
window.addEventListener("message", handleHostMessage);
window.addEventListener("unload", disposeControllers, { once: true });

api.postMessage({ type: "graph/ready" });

function handleHostMessage(event: MessageEvent<unknown>): void {
  const message = event.data;
  if (
    !isRecord(message) ||
    message.type !== "graph/state" ||
    !isGraphData(message.graph) ||
    !isGraphDepth(message.depth) ||
    typeof message.local !== "boolean"
  ) {
    return;
  }
  const nextScopeKey = `${message.local ? "local" : "workspace"}:${message.graph.focusId ?? ""}`;
  const scopeChanged = nextScopeKey !== scopeKey;
  fitPending ||= scopeChanged;
  if (scopeChanged) {
    selectedId = undefined;
    renderedGraph = { positions: new Map() };
  }
  scopeKey = nextScopeKey;
  graph = message.graph;
  updateDepthControl(message.depth, message.local);
  refreshVisibleGraph();
}

function refreshVisibleGraph(): void {
  const restoreNodeFocus = document.activeElement instanceof Element
    && document.activeElement.closest(".graph-node") !== null;
  const focusedConnectionId = connectionNodeIdFromTarget(document.activeElement);
  const kinds = new Set(
    kindToggles
      .filter((toggle) => toggle.checked)
      .map((toggle) => toggle.dataset.kind as GraphNodeKindWire),
  );
  visibleGraph = filterGraph(graph, kinds, orphanToggle.checked);
  visibleNodesById = new Map(visibleGraph.nodes.map((node) => [node.id, node]));
  selectedId = resolveSelection(visibleGraph, selectedId);
  hoveredId = undefined;
  emptyState.hidden = visibleGraph.nodes.length > 0;
  svg.toggleAttribute("hidden", visibleGraph.nodes.length === 0);
  renderedGraph = motion.render(visibleGraph, selectedId, renderedGraph.positions);
  // The SVG was rebuilt, so cached element handles and adjacency are stale.
  emphasis.refresh(visibleGraph);
  if (fitPending && renderedGraph.extent !== undefined) {
    viewport.fit(renderedGraph.extent);
    fitPending = false;
  }
  updateSearch();
  renderGraphDetails(details, visibleGraph, selectedId);
  updateViewportControls();
  if (restoreNodeFocus) {
    window.requestAnimationFrame(() => focusGraphNode(svg, selectedId));
  } else if (focusedConnectionId !== undefined) {
    window.requestAnimationFrame(() => {
      if (!focusConnectionRow(connections, focusedConnectionId)) focusGraphNode(svg, selectedId);
    });
  }
}

function updateSearch(): void {
  const query = search.value.trim();
  matchingIds = findMatchingNodeIds(visibleGraph, query);
  matchingIdSet = new Set(matchingIds);
  searchStatus.textContent = searchStatusText(query, matchingIds.length, visibleGraph.nodes.length);
  updateEmphasis();
}

function updateEmphasis(): void {
  emphasis.apply(
    visibleGraph,
    selectedId,
    hoveredId,
    matchingIdSet,
    search.value.trim().length > 0,
  );
}

function handleSearchKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape" && search.value.length > 0) {
    event.preventDefault();
    search.value = "";
    updateSearch();
    return;
  }
  if (event.key !== "Enter" || matchingIds.length === 0) return;
  event.preventDefault();
  selectNode(cycleNodeId(matchingIds, selectedId, event.shiftKey ? -1 : 1), { center: true });
}

function handleNodeSelection(event: MouseEvent): void {
  const nodeId = nodeIdFromTarget(event.target);
  if (nodeId === undefined) {
    clearSelection();
    return;
  }
  selectNode(nodeId);
}

function handleNodeOpen(event: MouseEvent): void {
  const node = findNode(nodeIdFromTarget(event.target));
  if (node?.uri !== undefined) api.postMessage({ type: "graph/open", uri: node.uri });
}

function handleNodePointerOver(event: PointerEvent): void {
  const nextId = nodeIdFromTarget(event.target);
  if (nextId === undefined || nextId === hoveredId) return;
  hoveredId = nextId;
  updateEmphasis();
}

function handleNodePointerOut(event: PointerEvent): void {
  if (nodeIdFromTarget(event.target) === undefined) return;
  const nextId = nodeIdFromTarget(event.relatedTarget);
  if (nextId === hoveredId) return;
  hoveredId = nextId;
  updateEmphasis();
}

function handleNodeKeydown(event: KeyboardEvent): void {
  const nodeId = nodeIdFromTarget(event.target);
  if (nodeId === undefined) return;
  if (event.key === "Escape") {
    event.preventDefault();
    clearSelection();
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    selectNode(nodeId);
    openSelectedNode();
    return;
  }
  if (event.key === " ") {
    event.preventDefault();
    selectNode(nodeId);
    return;
  }
  const nodeIds = visibleGraph.nodes.map((node) => node.id);
  const nextId = keyboardNodeId(nodeIds, event.key)
    ?? findSpatialNodeId(renderedGraph.positions, nodeId, event.key);
  if (nextId !== undefined) {
    event.preventDefault();
    selectNode(nextId, { center: true, focus: true });
  }
}

function handleConnectionSelection(event: MouseEvent): void {
  selectNode(connectionNodeIdFromTarget(event.target), { center: true, focus: true });
}

function selectNode(
  nodeId: string | undefined,
  options: { readonly center?: boolean; readonly focus?: boolean } = {},
): void {
  if (findNode(nodeId) === undefined) return;
  selectedId = nodeId;
  updateSearch();
  renderGraphDetails(details, visibleGraph, selectedId);
  updateViewportControls();
  if (options.center) centerSelectedNode();
  if (options.focus) window.requestAnimationFrame(() => focusGraphNode(svg, selectedId));
}

function clearSelection(): void {
  selectedId = visibleGraph.focusId;
  updateSearch();
  renderGraphDetails(details, visibleGraph, selectedId);
  updateViewportControls();
}

function fitVisibleGraph(): void {
  if (renderedGraph.extent !== undefined) viewport.fit(renderedGraph.extent);
}

function centerSelectedNode(): void {
  const point = selectedId === undefined ? undefined : renderedGraph.positions.get(selectedId);
  if (point !== undefined) viewport.center(point);
}

function updateViewportControls(): void {
  const unavailable = renderedGraph.extent === undefined;
  zoomIn.disabled = unavailable;
  zoomOut.disabled = unavailable;
  fitGraph.disabled = unavailable;
  centerSelected.disabled = selectedId === undefined || !renderedGraph.positions.has(selectedId);
  resetLayout.disabled = visibleGraph.nodes.length < 2;
}

function resetNodeLayout(): void {
  if (visibleGraph.nodes.length < 2) return;
  renderedGraph = { positions: new Map() };
  fitPending = true;
  refreshVisibleGraph();
}

function updateRenderedGraph(next: RenderedGraph): void {
  renderedGraph = next;
}

function disposeControllers(): void {
  motion.dispose();
  viewport.dispose();
}

function openSelectedNode(): void {
  const uri = findNode(selectedId)?.uri;
  if (uri !== undefined) api.postMessage({ type: "graph/open", uri });
}

function updateDepthControl(depth: 1 | 2, local: boolean): void {
  depthControl.hidden = !local;
  graphScope.textContent = local ? "Local connections" : "Workspace connections";
  for (const button of depthButtons) {
    const active = button.dataset.depth === String(depth);
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  }
}

function selectDepth(button: HTMLButtonElement): void {
  const depth = button.dataset.depth === "2" ? 2 : 1;
  for (const candidate of depthButtons) {
    const active = candidate === button;
    candidate.classList.toggle("is-active", active);
    candidate.setAttribute("aria-pressed", String(active));
  }
  api.postMessage({ type: "graph/depth", depth });
}

function nodeIdFromTarget(target: EventTarget | null): string | undefined {
  return target instanceof Element ? target.closest<SVGGElement>(".graph-node")?.dataset.nodeId : undefined;
}

function findNode(id: string | undefined): GraphNodeWire | undefined {
  return id === undefined ? undefined : visibleNodesById.get(id);
}

function searchStatusText(query: string, matches: number, visibleNodes: number): string {
  if (query.length === 0) return `${visibleNodes} visible node${visibleNodes === 1 ? "" : "s"}`;
  if (matches === 0) return "No matching nodes";
  return `${matches} match${matches === 1 ? "" : "es"} · Enter to cycle`;
}
