import type {
  GraphDataWire,
  GraphMenuCommandWire,
  GraphNodeKindWire,
  GraphNodeWire,
  GraphToHostWire,
} from "./contracts.js";
import { emptyState, isRecord, requireElement, setNotice } from "./shared/dom.js";
import { acquireWebviewApi } from "./shared/vscodeApi.js";
import { restoreFocusNextFrame } from "./shared/deferredFocus.js";
import { renderGraphDetails } from "./graph/details.js";
import { type GraphEmptyState, graphEmptyState } from "./graph/emptyStates.js";
import {
  filterGraph,
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
import { GraphSearchController } from "./graph/searchController.js";
import { GraphViewportController } from "./graph/viewportController.js";

const api = acquireWebviewApi<GraphToHostWire, unknown>();
const {
  svg, emptyState: canvasMessage, summary, depthControl, search, orphanToggle,
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
let matchingIdSet: ReadonlySet<string> = new Set();
let scopeKey: string | undefined;
let isLocalScope = false;
let revision = 0;
let fitPending = true;
/** Whether the drawing on the canvas is the restricted one, which only a repaint can undo. */
let restrictedToMatches = false;

const viewport = new GraphViewportController(svg, (percent) => {
  zoomStatus.textContent = `${percent}%`;
});
const emphasis = new GraphEmphasis(svg);
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const motion = new GraphMotionController(svg, updateRenderedGraph, () => !reducedMotion.matches);

const searchMode = requireElement("#graph-search-mode", HTMLSelectElement);
const workspaceButton = requireElement("#graph-workspace", HTMLButtonElement);
const scopeHint = requireElement("#graph-scope-hint", HTMLElement);
const errorNotice = requireElement("#graph-error", HTMLElement);
const resetFilters = requireElement("#graph-reset-filters", HTMLButtonElement);
restorePreferences();
const searchController = new GraphSearchController({
  send: (message) => api.postMessage(message),
  changed: applySearch,
  select: (id) => selectNode(id, { center: true }),
  save: savePreferences,
});
resetFilters.addEventListener("click", () => {
  for (const toggle of [...kindToggles, orphanToggle]) {
    toggle.classList.add("is-active");
    toggle.setAttribute("aria-pressed", "true");
  }
  refreshSearchContext();
  refreshVisibleGraph();
});
workspaceButton.addEventListener("click", () => api.postMessage({ type: "graph/runCommand", command: "openWorkspaceGraph" }));
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
  if (searchController.accept(message)) return;
  if (isRecord(message) && message.type === "graph/error") {
    if (message.requestId === undefined && typeof message.message === "string") setNotice(errorNotice, message.message);
    return;
  }
  if (
    !isRecord(message) ||
    message.type !== "graph/state" ||
    !isGraphData(message.graph) ||
    !isGraphDepth(message.depth) ||
    typeof message.local !== "boolean" ||
    typeof message.revision !== "number" || !Number.isSafeInteger(message.revision) || message.revision < 1
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
  revision = message.revision;
  setNotice(errorNotice);
  updateDepthControl(message.depth, message.local);
  updateChipCounts();
  refreshSearchContext();
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

function toggleChip(chip: HTMLButtonElement, searchChanged = true): void {
  const active = !chip.classList.contains("is-active");
  chip.classList.toggle("is-active", active);
  chip.setAttribute("aria-pressed", String(active));
  if (searchChanged) refreshSearchContext();
  else savePreferences();
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
  const matchingIds = searchController.matches;
  matchingIdSet = new Set(matchingIds);
  const restricting = isMatchesOnly();
  restrictedToMatches = restricting;
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
  searchController.setSelection(selectedId);
  updateEmphasis();
  renderGraphDetails(details, visibleGraph, selectedId);
  updateViewportControls();
  if (restoreNodeFocus) {
    restoreFocusNextFrame(() => focusGraphNode(svg, selectedId));
  } else if (focusedConnectionId !== undefined) {
    restoreFocusNextFrame(() => {
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
  /*
   * Also when the restriction has just stopped applying, which is what deleting the last
   * character of a query does while the toggle is still pressed. Asking only whether it
   * applies *now* left the canvas holding the nodes the previous keystroke had spared, with
   * an empty search box above it and the status line counting them as the whole graph.
   */
  if (isMatchesOnly() || restrictedToMatches) {
    // What is left has moved, and mostly shrunk, so the view goes back around it. Without
    // this the nodes that survived the last keystroke are usually off the edge of the canvas.
    fitPending = true;
    refreshVisibleGraph();
    return;
  }
  updateSearch();
}

function updateSearch(): void {
  matchingIdSet = new Set(searchController.matches);
  searchController.setSelection(selectedId);
  updateEmphasis();
}

function isMatchesOnly(): boolean {
  // With nothing typed there is nothing to keep, so the toggle waits rather than emptying
  // the canvas the moment it is pressed.
  return isChipActive(matchesOnlyToggle) && searchController.active && !searchController.pending && !searchController.failed;
}

function toggleMatchesOnly(): void {
  fitPending = true;
  toggleChip(matchesOnlyToggle, false);
}

function updateEmphasis(): void {
  emphasis.apply(
    visibleGraph,
    selectedId,
    hoveredId,
    matchingIdSet,
    searchController.active && !searchController.pending && !searchController.failed,
  );
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
  searchController.setSelection(selectedId);
  // Selection moves the emphasis, not the drawing, so the matches are the ones already found.
  updateEmphasis();
  renderGraphDetails(details, visibleGraph, selectedId);
  updateViewportControls();
  if (options.center) centerSelectedNode();
  if (options.focus) restoreFocusNextFrame(() => focusGraphNode(svg, selectedId));
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
  searchController.setSelection(selectedId);
  updateEmphasis();
  renderGraphDetails(details, visibleGraph, selectedId);
  updateViewportControls();
  if (hadFocusInCard) {
    restoreFocusNextFrame(() => {
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
  searchController.dispose();
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
  workspaceButton.hidden = !local;
  scopeHint.textContent = local ? "Search covers this local graph · Open Workspace graph to search every note" : "Search covers this workspace graph";
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

function refreshSearchContext(): void {
  resetFilters.hidden = kindToggles.every(isChipActive) && isChipActive(orphanToggle);
  const kinds = kindToggles.filter(isChipActive).map((toggle) => toggle.dataset.kind as GraphNodeKindWire);
  searchController.setContext(revision, graph, kinds, isChipActive(orphanToggle));
}

function savePreferences(): void {
  api.setState({ query: search.value, mode: searchMode.value,
    kinds: kindToggles.filter(isChipActive).map((toggle) => toggle.dataset.kind),
    orphans: isChipActive(orphanToggle), matchesOnly: isChipActive(matchesOnlyToggle) });
}

function restorePreferences(): void {
  const saved = api.getState();
  if (!isRecord(saved)) return;
  search.value = typeof saved.query === "string" ? saved.query.slice(0, 2048).replace(/[\r\n]/g, " ") : "";
  searchMode.value = saved.mode === "labels" ? "labels" : "all";
  const kinds = saved.kinds;
  for (const toggle of [...kindToggles, orphanToggle, matchesOnlyToggle]) {
    const active = toggle === orphanToggle ? saved.orphans !== false
      : toggle === matchesOnlyToggle ? saved.matchesOnly === true
        : !Array.isArray(kinds) || kinds.includes(toggle.dataset.kind);
    toggle.classList.toggle("is-active", active);
    toggle.setAttribute("aria-pressed", String(active));
  }
}
