import { createWebviewPage } from "./webviewPage";
import type { WebviewTemplateOptions } from "./webviewPage";

export function createGraphHtml(options: WebviewTemplateOptions): string {
  return createWebviewPage(options, {
    title: "Visp Notes Graph",
    styles: ["base.css", "graph.css"],
    script: "scripts/graph.js",
    body: `
      <div class="visp-shell graph-shell">
        <header class="view-toolbar graph-toolbar">
          <div class="title-stack">
            <span id="graph-scope" class="eyebrow">Connections</span>
            <h1 class="toolbar-title">Knowledge graph</h1>
          </div>
          <div class="toolbar-spacer"></div>
          <div id="depth-control" class="depth-control">
            <span class="control-label">Depth</span>
            <div class="segmented-control" role="group" aria-label="Link depth">
              <button class="segment is-active" type="button" data-depth="1" aria-pressed="true">1 hop</button>
              <button class="segment" type="button" data-depth="2" aria-pressed="false">2 hops</button>
            </div>
          </div>
        </header>
        <div class="graph-workspace">
          <aside class="graph-controls" aria-label="Graph filters">
            <label class="search-field graph-search">
              <span class="sr-only">Find a node</span>
              <span aria-hidden="true">⌕</span>
              <input id="graph-search" type="search" placeholder="Find a node" autocomplete="off"
                aria-describedby="graph-search-status">
            </label>
            <p id="graph-search-status" class="graph-search-status" aria-live="polite">0 visible nodes</p>
            <fieldset class="filter-fieldset">
              <legend>Display</legend>
              <label><span>Notes</span><input type="checkbox" data-kind="note" checked></label>
              <label><span>Tasks</span><input type="checkbox" data-kind="task" checked></label>
              <label><span>Tags</span><input type="checkbox" data-kind="tag" checked></label>
              <label><span>Unresolved</span><input type="checkbox" data-kind="unresolved" checked></label>
              <label><span>Orphan notes</span><input id="show-orphans" type="checkbox" checked></label>
            </fieldset>
            <div class="graph-legend" aria-label="Graph legend">
              <h2>Legend</h2>
              <span><i class="legend-dot note-dot"></i>Note</span>
              <span><i class="legend-dot task-dot"></i>Task</span>
              <span><i class="legend-dot tag-dot"></i>Tag</span>
              <span><i class="legend-dot unresolved-dot"></i>Unresolved</span>
            </div>
          </aside>
          <main class="graph-canvas">
            <div id="graph-empty" class="empty-state" hidden>No nodes match these filters.</div>
            <svg id="graph-svg" viewBox="0 0 960 640" role="group"
              aria-label="Interactive knowledge graph" aria-describedby="graph-keyboard-hint"></svg>
            <span id="graph-keyboard-hint" class="sr-only">
              Drag nodes to reshape the graph. Use arrow keys to move between nodes, Enter to open,
              and Space to select.
            </span>
            <div class="graph-viewport-controls" role="toolbar" aria-label="Graph viewport">
              <button id="graph-zoom-in" type="button" title="Zoom in" aria-label="Zoom in" disabled>+</button>
              <button id="graph-zoom-out" type="button" title="Zoom out" aria-label="Zoom out" disabled>−</button>
              <button id="graph-fit" class="viewport-text-button" type="button"
                title="Fit all nodes" disabled>Fit</button>
              <button id="graph-center" class="viewport-text-button" type="button"
                title="Center selected node" disabled>Center</button>
              <button id="graph-reset" class="viewport-text-button" type="button"
                title="Restart force layout" disabled>Reset</button>
              <output id="graph-zoom-status" aria-label="Zoom level">100%</output>
            </div>
          </main>
          <aside id="graph-details" class="graph-details">
            <span class="eyebrow">Selected node</span>
            <h2 id="selected-title" aria-live="polite">Select a node</h2>
            <p id="selected-kind" class="muted">Use arrow keys to move between nodes.</p>
            <dl class="node-stats">
              <div><dt>Links out</dt><dd id="selected-outgoing">0</dd></div>
              <div><dt>Links in</dt><dd id="selected-incoming">0</dd></div>
              <div><dt>Neighbors</dt><dd id="selected-neighbors">0</dd></div>
            </dl>
            <div class="connection-heading">
              <h3>Visible connections</h3>
              <span id="selected-connection-count">0</span>
            </div>
            <div id="selected-connections" class="connection-list">
              <p class="connection-empty muted">No visible connections.</p>
            </div>
            <button id="open-selected" class="primary-button full-width" type="button" disabled>Open note</button>
          </aside>
        </div>
      </div>`,
  });
}
