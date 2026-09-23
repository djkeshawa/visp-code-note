import type { GraphDataWire, GraphNodeKindWire, GraphNodeWire, GraphSearchResultWire, GraphToHostWire } from "../contracts.js";
import { codicon, emptyState, htmlElement, isRecord, requireElement } from "../shared/dom.js";
import { RovingList, isBareKey } from "../shared/rovingList.js";
import { tagHueColor } from "../../application/tagHue.js";
import { cycleNodeId } from "./interactionModel.js";

interface SearchActions {
  readonly send: (message: GraphToHostWire) => void;
  readonly changed: () => void;
  readonly select: (id: string) => void;
  readonly save: () => void;
}

/** Owns query requests and the results list; note contents stay in the extension host. */
export class GraphSearchController {
  private readonly input = requireElement("#graph-search", HTMLInputElement);
  private readonly mode = requireElement("#graph-search-mode", HTMLSelectElement);
  private readonly clear = requireElement("#graph-search-clear", HTMLButtonElement);
  private readonly panel = requireElement("#graph-search-panel", HTMLElement);
  private readonly root = requireElement("#graph-search-results", HTMLElement);
  private readonly status = requireElement("#graph-search-status", HTMLElement);
  private readonly limit = requireElement("#graph-result-limit", HTMLElement);
  private readonly previous = requireElement("#graph-match-previous", HTMLButtonElement);
  private readonly next = requireElement("#graph-match-next", HTMLButtonElement);
  private readonly navigation = new RovingList(this.root, { rows: ".graph-result", controls: "button" });
  private nodes: ReadonlyMap<string, GraphNodeWire> = new Map();
  private revision = 0;
  private requestId = 0;
  private kinds: readonly GraphNodeKindWire[] = [];
  private includeOrphans = true;
  private timer: number | undefined;
  private selectedId: string | undefined;
  private ids: readonly string[] = [];
  public pending = false;
  public failed = false;

  public constructor(private readonly actions: SearchActions) {
    this.input.addEventListener("input", () => this.schedule());
    this.mode.addEventListener("change", () => this.schedule());
    this.clear.addEventListener("click", () => this.clearSearch());
    this.input.addEventListener("keydown", (event) => this.handleKey(event));
    this.previous.addEventListener("click", () => this.cycle(-1));
    this.next.addEventListener("click", () => this.cycle(1));
  }

  public get active(): boolean { return this.input.value.trim() !== ""; }
  public get matches(): readonly string[] { return this.ids; }

  public setContext(revision: number, graph: GraphDataWire, kinds: readonly GraphNodeKindWire[], includeOrphans: boolean): void {
    const unchanged = revision === this.revision && includeOrphans === this.includeOrphans
      && kinds.length === this.kinds.length && kinds.every((kind) => this.kinds.includes(kind));
    this.nodes = new Map(graph.nodes.map((node) => [node.id, node]));
    if (unchanged) return;
    this.revision = revision;
    this.kinds = kinds;
    this.includeOrphans = includeOrphans;
    // Matches whose node has left the graph cannot be drawn or visited while the refresh runs.
    this.ids = this.ids.filter((id) => this.nodes.has(id));
    this.schedule();
  }

  public accept(value: unknown): boolean {
    if (!isRecord(value) || (value.type !== "graph/searchResults" && value.type !== "graph/error")) return false;
    if (value.requestId !== this.requestId || value.revision !== this.revision || !this.active) return false;
    if (value.type === "graph/error") {
      if (typeof value.message !== "string") return false;
      this.pending = false;
      this.failed = true;
      this.status.textContent = "Search failed";
      const state = emptyState("warning", value.message, "Try the search again.");
      const retry = htmlElement("button", "secondary-button empty-state-action", "Retry search");
      retry.type = "button";
      retry.addEventListener("click", () => this.schedule());
      state.append(retry);
      this.root.replaceChildren(state);
      this.actions.changed();
      return true;
    }
    if (!isSearchPage(value)) return false;
    const wasPending = this.pending;
    const previous = this.ids;
    this.pending = false;
    this.root.removeAttribute("aria-busy");
    this.ids = [...new Set(value.nodeIds)].filter((id) => this.nodes.has(id));
    const matches = new Set(this.ids);
    const rows = value.results.filter((result) => matches.has(result.nodeId));
    const scrollTop = this.root.scrollTop;
    this.root.replaceChildren(...(rows.length > 0 ? rows.map((result) => this.resultRow(result))
      : [emptyState("search", "No matches in this graph.", "Try fewer words, enable more node types, or open the workspace graph.")]));
    this.limit.hidden = this.ids.length <= rows.length;
    this.limit.textContent = `Showing the first ${rows.length} of ${this.ids.length} matches. Refine your search to narrow the list; arrows visit every match.`;
    this.root.scrollTop = scrollTop;
    this.updateSelection();
    this.navigation.refresh();
    /*
     * An index update re-runs the search behind the same query, and usually finds the same
     * nodes. Telling the graph would redraw and refit it for nothing, throwing away the
     * user's zoom and pan on every save.
     */
    if (wasPending || !sameIds(previous, this.ids)) this.actions.changed();
    return true;
  }

  public setSelection(id: string | undefined): void {
    this.selectedId = id;
    if (!this.pending && !this.failed && this.active) this.updateSelection();
  }

  public dispose(): void {
    window.clearTimeout(this.timer);
    this.requestId += 1;
  }

  private schedule(): void {
    window.clearTimeout(this.timer);
    const requestId = ++this.requestId;
    this.actions.save();
    /*
     * With results already on screen, they stay there until the replacement arrives. Clearing
     * them made the graph drop its matches-only restriction for the length of the round trip,
     * so every keystroke and every index update flashed the whole graph and refit the view.
     */
    const refreshing = this.active && !this.pending && !this.failed && this.panel.hidden === false;
    if (refreshing) {
      this.root.setAttribute("aria-busy", "true");
    } else {
      this.ids = [];
      this.pending = this.active;
      this.failed = false;
      this.panel.hidden = !this.active;
      this.clear.hidden = !this.active;
      this.previous.disabled = this.next.disabled = true;
      this.limit.hidden = true;
      this.root.removeAttribute("aria-busy");
      this.root.replaceChildren(...(this.active ? [emptyState("loading", "Searching this graph…")] : []));
      this.status.textContent = this.active ? "Searching…" : "";
      this.actions.changed();
    }
    if (!this.active || this.revision === 0) return;
    this.timer = window.setTimeout(() => {
      this.actions.send({ type: "graph/search", requestId, revision: this.revision,
        query: this.input.value.slice(0, 2048), mode: this.mode.value === "labels" ? "labels" : "all",
        kinds: this.kinds, includeOrphans: this.includeOrphans });
    }, 150);
  }

  private clearSearch(): void {
    this.input.value = "";
    this.schedule();
    this.input.focus();
  }

  private handleKey(event: KeyboardEvent): void {
    if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "Escape" && this.active) {
      event.preventDefault();
      this.clearSearch();
    } else if (event.key === "Enter" && this.ids.length > 0) {
      event.preventDefault();
      this.cycle(event.shiftKey ? -1 : 1);
    } else if (event.key === "ArrowDown" && isBareKey(event) && this.ids.length > 0) {
      event.preventDefault();
      this.navigation.focusFirst();
    }
  }

  private cycle(direction: 1 | -1): void {
    const id = cycleNodeId(this.ids, this.selectedId, direction);
    if (id !== undefined) this.actions.select(id);
  }

  private updateSelection(): void {
    const index = this.selectedId === undefined ? -1 : this.ids.indexOf(this.selectedId);
    this.status.textContent = index >= 0 ? `Match ${index + 1} of ${this.ids.length}`
      : `${this.ids.length} match${this.ids.length === 1 ? "" : "es"}`;
    this.previous.disabled = this.next.disabled = this.ids.length === 0;
    for (const row of Array.from(this.root.querySelectorAll<HTMLElement>(".graph-result"))) {
      const selected = row.dataset.nodeId === this.selectedId;
      row.classList.toggle("is-selected", selected);
      row.querySelector(".graph-result-select")?.setAttribute("aria-current", String(selected));
    }
  }

  private resultRow(result: GraphSearchResultWire): HTMLElement {
    const node = this.nodes.get(result.nodeId)!;
    const row = htmlElement("div", "graph-result");
    row.dataset.nodeId = node.id;
    const select = htmlElement("button", "graph-result-select");
    select.type = "button";
    select.title = `Locate ${node.label} in the graph`;
    const heading = htmlElement("span", "graph-result-title");
    const marker = htmlElement("span", `connection-marker marker-${node.kind}`);
    marker.setAttribute("aria-hidden", "true");
    if (node.kind === "tag") marker.style.setProperty("--tag-hue", tagHueColor(node.label));
    heading.append(marker, document.createTextNode(node.label));
    select.append(heading,
      htmlElement("span", "graph-result-field", result.matchedField === "task" ? "Task text" : `${node.kind} · ${result.matchedField === "body" ? "note text" : result.matchedField}`),
      htmlElement("span", "graph-result-preview", result.preview));
    if (result.path !== undefined) select.append(htmlElement("span", "graph-result-path", result.path));
    select.addEventListener("click", () => this.actions.select(node.id));
    row.append(select);
    if (result.uri !== undefined && result.uri === node.uri) {
      const open = htmlElement("button", "icon-button graph-result-open");
      open.type = "button";
      open.title = `Open match in ${node.label}`;
      open.setAttribute("aria-label", open.title);
      open.append(codicon("go-to-file"));
      open.addEventListener("click", () => this.actions.send({ type: "graph/open", uri: result.uri!, start: result.start }));
      row.append(open);
    }
    return row;
  }
}

function isSearchPage(value: Record<string, unknown>): value is Record<string, unknown> & {
  nodeIds: string[]; results: GraphSearchResultWire[];
} {
  return Array.isArray(value.nodeIds) && value.nodeIds.every((id) => typeof id === "string")
    && Array.isArray(value.results) && value.results.length <= 100
    && value.results.every((row: unknown) => isRecord(row) && typeof row.nodeId === "string"
      && typeof row.preview === "string" && typeof row.matchedField === "string"
      && ["title", "path", "alias", "tag", "body", "task", "label"].includes(row.matchedField)
      && (row.uri === undefined || typeof row.uri === "string")
      && (row.path === undefined || typeof row.path === "string")
      && (row.start === undefined || (typeof row.start === "number" && Number.isSafeInteger(row.start) && row.start >= 0)));
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}
