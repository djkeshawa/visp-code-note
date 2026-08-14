import type {
  GraphDataWire,
  GraphMenuCommandWire,
  GraphNodeKindWire,
  GraphNodeWire,
  GraphToHostWire,
} from "./contracts.js";
import { emptyState, isRecord } from "./shared/dom.js";
import { acquireMessageSender } from "./shared/vscodeApi.js";
import { renderGraphDetails } from "./graph/details.js";
import { type GraphEmptyState, graphEmptyState } from "./graph/emptyStates.js";
import {
  cycleNodeId,
  filterGraph,
  findMatchingNodeIds,
  graphAroundMatches,
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
  svg, emptyState: canvasMessage, summary, depthControl, search, searchStatus, orphanToggle,
  matchesOnlyToggle, connections, zoomIn, zoomOut, fitGraph, centerSelected, zoomStatus,
  resetLayout, kindToggles, depthButtons, chipCounts, menu, menuButton, menuItems, details,
} = getGraphPageElements();
const openSelected = details.openButton;
const focusSelected = details.focusButton;

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
let isLocalScope = false;
let fitPending = true;

const viewport = new GraphViewportController(svg, (percent) => {
  zoomStatus.textContent = `${percent}%`;
});
const emphasis = new GraphEmphasis(svg);
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const motion = new GraphMotionController(svg, updateRenderedGraph, () => !reducedMotion.matches);

search.addEventListener("input", applySearch);
search.addEventListener("keydown", handleSearchKeydown);
orphanToggle.addEventListener("click", () => toggleChip(orphanToggle));
matchesOnlyToggle.addEventListener("click", toggleMatchesOnly);
kindToggles.forEach((toggle) => toggle.addEventListener("click", () => toggleChip(toggle)));
depthButtons.forEach((button) => button.addEventListener("click", () => selectDepth(button)));
menuButton.addEventListener("click", () => setMenuOpen(menu.hidden));
menuItems.forEach((item) => item.addEventListener("click", () => runMenuCommand(item)));
document.addEventListener("click", closeMenuOnOutsideClick, true);
document.addEventListener("keydown", closeMenuOnEscape);
svg.addEventListener("click", handleNodeSelection);
svg.addEventListener("dblclick", handleNodeOpen);
svg.addEventListener("keydown", handleNodeKeydown);
svg.addEventListener("pointerover", handleNodePointerOver);
svg.addEventListener("pointerout", handleNodePointerOut);
connections.addEventListener("click", handleConnectionSelection);
details.closeButton.addEventListener("click", clearSelection);
openSelected.addEventListener("click", openSelectedNode);
focusSelected.addEventListener("click", focusSelectedNode);
zoomIn.addEventListener("click", () => viewport.zoomBy(1.25));
zoomOut.addEventListener("click", () => viewport.zoomBy(0.8));
fitGraph.addEventListener("click", fitVisibleGraph);
centerSelected.addEventListener("click", centerSelectedNode);
resetLayout.addEventListener("click", resetNodeLayout);
window.addEventListener("message", handleHostMessage);
window.addEventListener("unload", disposeControllers, { once: true });

// Paint the loading state before the host replies; otherwise the canvas opens blank.
paintCanvasMessage({ icon: "loading", message: "Building the graph…" });
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
  updateChipCounts();
  refreshVisibleGraph();
}

/** Chip counts come from the whole graph, so turning a filter off does not zero its own count. */
function updateChipCounts(): void {
  const counts = new Map<string, number>();
  for (const node of graph.nodes) {
    counts.set(node.kind, (counts.get(node.kind) ?? 0) + 1);
    if (node.orphan === true) counts.set("orphan", (counts.get("orphan") ?? 0) + 1);
  }
  for (const element of chipCounts) {
    const key = element.dataset.count;
    element.textContent = String(key === undefined ? 0 : counts.get(key) ?? 0);
  }
}

function toggleChip(chip: HTMLButtonElement): void {
  const active = !chip.classList.contains("is-active");
  chip.classList.toggle("is-active", active);
  chip.setAttribute("aria-pressed", String(active));
  refreshVisibleGraph();
}

function isChipActive(chip: HTMLButtonElement): boolean {
  return chip.classList.contains("is-active");
}

function refreshVisibleGraph(): void {
  const restoreNodeFocus = document.activeElement instanceof Element
    && document.activeElement.closest(".graph-node") !== null;
  const focusedConnectionId = connectionNodeIdFromTarget(document.activeElement);
  const kinds = new Set(
    kindToggles
      .filter(isChipActive)
      .map((toggle) => toggle.dataset.kind as GraphNodeKindWire),
  );
  const filtered = filterGraph(graph, kinds, isChipActive(orphanToggle));
  /*
   * Matching runs against the filtered graph, before the restriction is applied — otherwise
   * each keystroke would search only what the previous keystroke had already left standing,
   * and a deleted character could never bring a node back.
   */
  const query = search.value.trim();
  matchingIds = findMatchingNodeIds(filtered, query);
  matchingIdSet = new Set(matchingIds);
  const restricting = isMatchesOnly();
  visibleGraph = restricting ? graphAroundMatches(filtered, matchingIds) : filtered;
  visibleNodesById = new Map(visibleGraph.nodes.map((node) => [node.id, node]));
  selectedId = resolveSelection(visibleGraph, selectedId);
  hoveredId = undefined;
  paintCanvasMessage(
    graphEmptyState(graph.nodes.length, visibleGraph.nodes.length, isLocalScope, restricting),
  );
  svg.toggleAttribute("hidden", visibleGraph.nodes.length === 0);
  renderedGraph = motion.render(visibleGraph, selectedId, renderedGraph.positions);
  // The SVG was rebuilt, so cached element handles and adjacency are stale.
  emphasis.refresh(visibleGraph);
  if (fitPending && renderedGraph.extent !== undefined) {
    viewport.fit(renderedGraph.extent);
    fitPending = false;
  }
  updateSummary();
  updateSearchStatus();
  updateEmphasis();
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

/**
 * The canvas carries one message at a time — first that the graph is being built, then whatever
 * reason it has for being empty — and nothing at all once there are nodes over it.
 */
function paintCanvasMessage(state: GraphEmptyState | undefined): void {
  canvasMessage.replaceChildren(
    ...(state === undefined ? [] : [emptyState(state.icon, state.message, state.hint)]),
  );
  canvasMessage.hidden = state === undefined;
}

function updateSummary(): void {
  const nodes = visibleGraph.nodes.length;
  const links = visibleGraph.edges.length;
  summary.textContent = [
    isLocalScope ? "local" : "workspace",
    `${nodes} node${nodes === 1 ? "" : "s"}`,
    `${links} link${links === 1 ? "" : "s"}`,
  ].join(" · ");
}

/**
 * A search either dims what it did not match or takes it off the canvas, and the two cost
 * very different amounts: dimming touches the nodes already drawn, while restricting rebuilds
 * the drawing. Only the second needs a full refresh, so only the second gets one.
 */
function applySearch(): void {
  if (isMatchesOnly()) {
    // What is left has moved, and mostly shrunk, so the view goes back around it. Without
    // this the nodes that survived the last keystroke are usually off the edge of the canvas.
    fitPending = true;
    refreshVisibleGraph();
    return;
  }
  updateSearch();
}

function updateSearch(): void {
  matchingIds = findMatchingNodeIds(visibleGraph, search.value.trim());
  matchingIdSet = new Set(matchingIds);
  updateSearchStatus();
  updateEmphasis();
}

function updateSearchStatus(): void {
  searchStatus.textContent = searchStatusText(
    search.value.trim(),
    matchingIds.length,
    visibleGraph.nodes.length,
  );
}

function isMatchesOnly(): boolean {
  // With nothing typed there is nothing to keep, so the toggle waits rather than emptying
  // the canvas the moment it is pressed.
  return isChipActive(matchesOnlyToggle) && search.value.trim().length > 0;
}

function toggleMatchesOnly(): void {
  fitPending = true;
  toggleChip(matchesOnlyToggle);
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
    applySearch();
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
  // Selection moves the emphasis, not the drawing, so the matches are the ones already found.
  updateEmphasis();
  renderGraphDetails(details, visibleGraph, selectedId);
  updateViewportControls();
  if (options.center) centerSelectedNode();
  if (options.focus) window.requestAnimationFrame(() => focusGraphNode(svg, selectedId));
}

function clearSelection(): void {
  /*
   * Clearing hides the details card, which on the workspace graph is the element the close
   * button lives in — so dismissing it from the keyboard hid the button along with the focus
   * on it, and focus fell to the body. The graph itself is where the reader was, so that is
   * where focus goes back to: the node still selected, or the canvas when none is.
   */
  const hadFocusInCard = details.card.contains(document.activeElement);
  selectedId = visibleGraph.focusId;
  updateEmphasis();
  renderGraphDetails(details, visibleGraph, selectedId);
  updateViewportControls();
  if (hadFocusInCard) {
    window.requestAnimationFrame(() => {
      if (selectedId !== undefined) {
        focusGraphNode(svg, selectedId);
        return;
      }
      /*
       * With nothing selected there is no node to return to, and the canvas itself is not a
       * tab stop — the nodes carry a roving tabindex instead. The graph's own single tab stop
       * is the right landing place; the search field is the fallback if the graph is empty.
       */
      const stop = svg.querySelector<SVGGElement>('.graph-node[tabindex="0"]');
      if (stop !== null) stop.focus();
      else search.focus();
    });
  }
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

/**
 * Ask the host to redraw around this note. The host answers with a whole new graph, which
 * arrives as a scope change and resets the layout, the selection and the view — so nothing
 * is done here beyond asking. Open Workspace Graph, in the overflow menu, is the way back.
 */
function focusSelectedNode(): void {
  const uri = findNode(selectedId)?.uri;
  if (uri !== undefined && selectedId !== visibleGraph.focusId) {
    api.postMessage({ type: "graph/focus", uri });
  }
}

function setMenuOpen(open: boolean): void {
  // Closing returns focus to the button that opened it — see the editor's menu for why.
  const hadFocusInside = menu.contains(document.activeElement);
  menu.hidden = !open;
  menuButton.setAttribute("aria-expanded", String(open));
  if (!open && hadFocusInside) menuButton.focus();
  if (open) {
    const workspaceItem = menu.querySelector<HTMLButtonElement>('[data-command="openWorkspaceGraph"]');
    // Already looking at the whole workspace: the entry would be a no-op.
    if (workspaceItem !== null) workspaceItem.disabled = !isLocalScope;
    menu.querySelector<HTMLButtonElement>(".menu-item:not(:disabled)")?.focus();
  }
}

function runMenuCommand(item: HTMLButtonElement): void {
  const command = item.dataset.command;
  setMenuOpen(false);
  if (command === "openWorkspaceGraph" || command === "rebuildIndex") {
    api.postMessage({ type: "graph/runCommand", command: command satisfies GraphMenuCommandWire });
  }
}

function closeMenuOnOutsideClick(event: MouseEvent): void {
  if (menu.hidden || !(event.target instanceof Node)) return;
  if (menu.contains(event.target) || menuButton.contains(event.target)) return;
  setMenuOpen(false);
}

function closeMenuOnEscape(event: KeyboardEvent): void {
  if (event.key !== "Escape" || menu.hidden) return;
  event.preventDefault();
  setMenuOpen(false);
  menuButton.focus();
}

/**
 * Hop depth only means something around a focused note. On the workspace graph the control
 * stays in place, disabled and saying why, rather than vanishing and shifting the toolbar.
 */
function updateDepthControl(depth: 1 | 2, local: boolean): void {
  isLocalScope = local;
  depthControl.classList.toggle("is-unavailable", !local);
  depthControl.title = local
    ? "How many links out from this note to include"
    : "Hops apply to a note's local graph";
  for (const button of depthButtons) {
    const active = button.dataset.depth === String(depth);
    button.disabled = !local;
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
  const found = `${matches} match${matches === 1 ? "" : "es"}`;
  // How much is left on the canvas is the whole point of the toggle, so it is said aloud.
  return isMatchesOnly()
    ? `${found} · ${visibleNodes} node${visibleNodes === 1 ? "" : "s"} shown · Enter to cycle`
    : `${found} · Enter to cycle`;
}
