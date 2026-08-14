/**
 * The markup of each view, apart from the document wrapper that carries the content security
 * policy and the asset URLs.
 *
 * Split out because the wrapper needs `vscode` to resolve webview URIs and this does not:
 * keeping the markup importable on its own is what lets a preview harness and a test render
 * the real page instead of a copy of it that drifts.
 */

export const EDITOR_BODY = `
      <div class="visp-shell editor-shell">
        <header class="editor-toolbar">
          <span class="codicon codicon-note editor-note-icon" aria-hidden="true"></span>
          <h1 id="note-title" class="editor-title">Loading note…</h1>
          <nav id="note-breadcrumb" class="note-breadcrumb" aria-label="Note location"></nav>
          <span id="note-tags" class="note-tags"></span>
          <button id="note-tags-summary" class="pill note-tags-summary" type="button" hidden></button>
          <div class="toolbar-spacer"></div>
          <button id="toggle-inspector" class="toolbar-button" type="button"
            aria-controls="note-inspector" aria-expanded="true" title="Note inspector">
            <span class="codicon codicon-references" aria-hidden="true"></span>
            <span id="inspector-count">0</span>
            <span class="sr-only">Toggle the note inspector</span>
          </button>
          <div class="segmented-control" role="group" aria-label="Editor mode">
            <button id="live-mode" class="segment is-active" type="button" aria-pressed="true">Live</button>
            <button id="markdown-mode" class="segment" type="button" aria-pressed="false">Markdown</button>
          </div>
          <button id="sync-status" class="sync-status" type="button" title="Ctrl/Cmd+S saves">
            <span id="sync-status-dot" class="sync-dot" aria-hidden="true"></span>
            <span id="sync-status-text" role="status" aria-live="polite" aria-atomic="true">Loading note…</span>
          </button>
          <button id="editor-menu-button" class="icon-button" type="button"
            aria-controls="editor-menu" aria-expanded="false" aria-haspopup="true" title="More actions">
            <span class="codicon codicon-ellipsis" aria-hidden="true"></span>
            <span class="sr-only">More note actions</span>
          </button>
        </header>
        <div id="editor-menu" class="editor-menu" role="menu" aria-label="Note actions" hidden>
          <button class="editor-menu-item" type="button" role="menuitem" data-command="insertLink">
            <span class="codicon codicon-link" aria-hidden="true"></span>
            <span class="editor-menu-label">Insert Link</span>
            <span class="editor-menu-hint" data-binding="insertLink"></span>
          </button>
          <button class="editor-menu-item" type="button" role="menuitem" data-command="newTask">
            <span class="codicon codicon-checklist" aria-hidden="true"></span>
            <span class="editor-menu-label">New Task</span>
            <span class="editor-menu-hint"></span>
          </button>
          <button class="editor-menu-item" type="button" role="menuitem" data-command="renameNote">
            <span class="codicon codicon-replace-all" aria-hidden="true"></span>
            <span class="editor-menu-label">Rename Note and Update Links</span>
            <span class="editor-menu-hint"></span>
          </button>
          <button class="editor-menu-item" type="button" role="menuitem" data-command="findBrokenLinks">
            <span class="codicon codicon-warning" aria-hidden="true"></span>
            <span class="editor-menu-label">Find Broken Links</span>
            <span id="broken-link-hint" class="editor-menu-hint"></span>
          </button>
          <button class="editor-menu-item" type="button" role="menuitem" data-command="openLocalGraph">
            <span class="codicon codicon-type-hierarchy" aria-hidden="true"></span>
            <span class="editor-menu-label">Open Local Graph</span>
            <span class="editor-menu-hint"></span>
          </button>
          <button class="editor-menu-item" type="button" role="menuitem" data-command="rebuildIndex">
            <span class="codicon codicon-refresh" aria-hidden="true"></span>
            <span class="editor-menu-label">Rebuild Index</span>
            <span class="editor-menu-hint"></span>
          </button>
          <div class="editor-menu-separator" role="separator"></div>
          <div class="editor-menu-row is-static">
            <span class="editor-menu-row-label">Formatting</span>
          </div>
          <div id="editor-menu-formatting" class="editor-menu-formatting"
            role="group" aria-label="Formatting keys"></div>
          <div class="editor-menu-separator" role="separator"></div>
          <div class="editor-menu-row">
            <span class="editor-menu-row-label" id="content-width-label">Content width</span>
            <div class="segmented-control is-compact" role="group" aria-labelledby="content-width-label">
              <button class="segment" type="button" data-width="readable" aria-pressed="false">Readable</button>
              <button class="segment" type="button" data-width="wide" aria-pressed="false">Wide</button>
              <button class="segment" type="button" data-width="full" aria-pressed="false">Full</button>
            </div>
          </div>
        </div>
        <div id="editor-error" class="notice notice-error" role="alert" hidden></div>
        <div id="editor-conflict" class="notice notice-warning draft-conflict" role="alert" aria-atomic="true" hidden></div>
        <div class="editor-body view-body">
          <main class="editor-content">
            <div id="editor-host" class="editor-host is-live-mode" aria-describedby="sync-status-text"></div>
          </main>
          <aside id="note-inspector" class="note-inspector" aria-label="Note inspector">
            <h2 class="section-rule inspector-section is-first">
              <span class="eyebrow">Outline</span>
            </h2>
            <div id="inspector-outline" class="inspector-outline"></div>
            <h2 class="section-rule inspector-section">
              <span class="eyebrow">Backlinks</span>
              <span id="inspector-backlink-count" class="section-count">0</span>
            </h2>
            <div id="inspector-backlinks" class="inspector-backlinks"></div>
            <h2 class="section-rule inspector-section">
              <span class="eyebrow">Tasks in this note</span>
              <span id="inspector-task-count" class="section-count">0</span>
            </h2>
            <div id="inspector-tasks" class="inspector-tasks"></div>
            <h2 class="section-rule inspector-section">
              <span class="eyebrow">Links out</span>
              <span id="inspector-link-count" class="section-count">0</span>
            </h2>
            <div id="inspector-links" class="inspector-links"></div>
          </aside>
        </div>
      </div>`;

export const TASKS_BODY = `
      <div class="visp-shell tasks-shell">
        <header class="view-toolbar tasks-toolbar">
          <div class="title-stack">
            <h1 id="task-view-title" class="toolbar-title">Tasks</h1>
          </div>
          <p id="task-summary" class="toolbar-subtitle">Waiting for index…</p>
          <div class="toolbar-spacer"></div>
          <label class="search-field tasks-search">
            <span class="sr-only">Filter tasks</span>
            <span class="codicon codicon-search" aria-hidden="true"></span>
            <input id="task-search" type="search" placeholder="Filter tasks" autocomplete="off">
          </label>
          <div id="task-status" class="segmented-control" role="group" aria-label="Task status">
            <button class="segment is-active" type="button" data-status="open" aria-pressed="true">Open</button>
            <button class="segment" type="button" data-status="all" aria-pressed="false">All</button>
            <button class="segment" type="button" data-status="completed" aria-pressed="false">Done</button>
          </div>
          <label class="toolbar-select" title="Group tasks by">
            <span class="codicon codicon-list-tree" aria-hidden="true"></span>
            <span class="sr-only">Group tasks by</span>
            <span class="toolbar-select-label" aria-hidden="true">Group</span>
            <select id="task-group-by">
              <option value="due">Due date</option>
              <option value="note">Note</option>
              <option value="tag">Tag</option>
            </select>
            <span class="codicon codicon-chevron-down" aria-hidden="true"></span>
          </label>
          <div class="toolbar-sort">
            <label class="toolbar-select" title="Sort tasks by">
              <span class="codicon codicon-sort-precedence" aria-hidden="true"></span>
              <span class="sr-only">Sort tasks by</span>
              <span class="toolbar-select-label" aria-hidden="true">Sort</span>
              <select id="task-sort-by">
                <option value="due">Due date</option>
                <option value="created">Note created</option>
                <option value="text">Task text</option>
              </select>
              <span class="codicon codicon-chevron-down" aria-hidden="true"></span>
            </label>
            <button id="task-sort-direction" class="icon-button" type="button"
              title="Ascending — switch to descending" aria-pressed="false">
              <span class="codicon codicon-arrow-up" aria-hidden="true"></span>
              <span class="sr-only">Toggle sort direction</span>
            </button>
          </div>
        </header>
        <div id="tasks-error" class="notice notice-error" role="alert" hidden></div>
        <main id="task-groups" class="task-groups view-body"></main>
        <footer class="view-footer">
          <span id="task-count" role="status" aria-live="polite">Waiting for index…</span>
          <span class="footer-hint">Space toggles · Enter opens the note</span>
        </footer>
      </div>`;

export const NOTES_BODY = `
      <div class="visp-shell notes-shell">
        <header class="view-toolbar notes-toolbar">
          <div class="title-stack">
            <h1 id="note-view-title" class="toolbar-title">Notes</h1>
          </div>
          <p id="note-summary" class="toolbar-subtitle">Waiting for index…</p>
          <div class="toolbar-spacer"></div>
          <label class="search-field notes-search">
            <span class="sr-only">Filter notes</span>
            <span class="codicon codicon-search" aria-hidden="true"></span>
            <input id="note-search" type="search" placeholder="Filter notes" autocomplete="off">
          </label>
        </header>
        <div id="notes-error" class="notice notice-error" role="alert" hidden></div>
        <main id="note-rows" class="note-rows view-body"></main>
        <footer class="view-footer">
          <span id="note-count" role="status" aria-live="polite">Waiting for index…</span>
          <span class="footer-hint">Enter opens the note</span>
        </footer>
      </div>`;

export const GRAPH_BODY = `
      <div class="visp-shell graph-shell">
        <header class="view-toolbar graph-toolbar">
          <div class="title-stack">
            <h1 class="toolbar-title">Knowledge graph</h1>
          </div>
          <p id="graph-summary" class="toolbar-subtitle">Building the graph…</p>
          <div class="toolbar-spacer"></div>
          <label class="search-field graph-search">
            <span class="sr-only">Find a node</span>
            <span class="codicon codicon-search" aria-hidden="true"></span>
            <input id="graph-search" type="search" placeholder="Find a node" autocomplete="off"
              aria-describedby="graph-search-status">
          </label>
          <p id="graph-search-status" class="sr-only" aria-live="polite">0 visible nodes</p>
          <div id="depth-control" class="segmented-control" role="group" aria-label="Link depth">
            <button class="segment is-active" type="button" data-depth="1" aria-pressed="true">1 hop</button>
            <button class="segment" type="button" data-depth="2" aria-pressed="false">2 hops</button>
          </div>
          <button id="graph-menu-button" class="icon-button" type="button"
            aria-controls="graph-menu" aria-expanded="false" aria-haspopup="true" title="More graph actions">
            <span class="codicon codicon-ellipsis" aria-hidden="true"></span>
            <span class="sr-only">More graph actions</span>
          </button>
        </header>
        <div id="graph-menu" class="floating-menu graph-menu" role="menu" aria-label="Graph actions" hidden>
          <button class="menu-item" type="button" role="menuitem" data-command="openWorkspaceGraph">
            <span class="codicon codicon-type-hierarchy" aria-hidden="true"></span>
            <span class="menu-label">Open Workspace Graph</span>
          </button>
          <button class="menu-item" type="button" role="menuitem" data-command="rebuildIndex">
            <span class="codicon codicon-refresh" aria-hidden="true"></span>
            <span class="menu-label">Rebuild Index</span>
          </button>
        </div>
        <main class="graph-canvas view-body">
          <svg id="graph-svg" viewBox="0 0 960 640" role="group"
            aria-label="Interactive knowledge graph" aria-describedby="graph-keyboard-hint"></svg>
          <span id="graph-keyboard-hint" class="sr-only">
            Drag nodes to reshape the graph. Use arrow keys to move between nodes, Enter to open,
            and Space to select.
          </span>
          <div id="graph-empty" class="graph-empty" hidden></div>
          <div class="graph-filters" role="group" aria-label="Graph filters">
            <button class="graph-chip is-active" type="button" data-kind="note" aria-pressed="true">
              <span class="graph-chip-dot dot-note"></span>Notes
              <span class="graph-chip-count" data-count="note">0</span>
            </button>
            <button class="graph-chip is-active" type="button" data-kind="tag" aria-pressed="true">
              <span class="graph-chip-dot dot-tag"></span>Tags
              <span class="graph-chip-count" data-count="tag">0</span>
            </button>
            <button class="graph-chip is-active" type="button" data-kind="unresolved" aria-pressed="true">
              <span class="graph-chip-dot dot-unresolved"></span>Unresolved
              <span class="graph-chip-count" data-count="unresolved">0</span>
            </button>
            <button class="graph-chip is-active" type="button" data-kind="task" aria-pressed="true">
              <span class="graph-chip-dot dot-task"></span>Tasks
              <span class="graph-chip-count" data-count="task">0</span>
            </button>
            <button id="show-orphans" class="graph-chip is-active" type="button"
              data-orphans="true" aria-pressed="true">
              <span class="graph-chip-dot dot-orphan"></span>Orphans
              <span class="graph-chip-count" data-count="orphan">0</span>
            </button>
          </div>
          <div class="graph-viewport-controls" role="toolbar" aria-label="Graph viewport">
            <button id="graph-zoom-out" type="button" title="Zoom out" aria-label="Zoom out" disabled>
              <span class="codicon codicon-zoom-out" aria-hidden="true"></span>
            </button>
            <output id="graph-zoom-status" aria-label="Zoom level">100%</output>
            <button id="graph-zoom-in" type="button" title="Zoom in" aria-label="Zoom in" disabled>
              <span class="codicon codicon-zoom-in" aria-hidden="true"></span>
            </button>
            <span class="viewport-divider" aria-hidden="true"></span>
            <button id="graph-fit" type="button" title="Fit all nodes" aria-label="Fit all nodes" disabled>
              <span class="codicon codicon-screen-full" aria-hidden="true"></span>
            </button>
            <button id="graph-center" type="button" title="Center selection" aria-label="Center selection" disabled>
              <span class="codicon codicon-target" aria-hidden="true"></span>
            </button>
            <button id="graph-reset" type="button" title="Restart layout" aria-label="Restart layout" disabled>
              <span class="codicon codicon-debug-restart" aria-hidden="true"></span>
            </button>
          </div>
          <aside id="graph-details" class="graph-details" aria-label="Selected node" hidden>
            <div class="graph-details-header">
              <span id="selected-dot" class="graph-details-dot"></span>
              <h2 id="selected-title" aria-live="polite">Select a node</h2>
              <button id="graph-details-close" class="icon-button" type="button"
                title="Clear selection" aria-label="Clear selection">
                <span class="codicon codicon-close" aria-hidden="true"></span>
              </button>
            </div>
            <dl class="node-stats">
              <div><dd id="selected-outgoing">0</dd><dt>out</dt></div>
              <div><dd id="selected-incoming">0</dd><dt>in</dt></div>
              <div><dd id="selected-neighbors">0</dd><dt>neighbours</dt></div>
            </dl>
            <div id="selected-connections" class="connection-list"></div>
            <span id="selected-connection-count" class="sr-only">0</span>
            <div class="graph-details-actions">
              <button id="open-selected" class="primary-button" type="button" disabled>Open note</button>
              <button id="focus-selected" class="secondary-button" type="button" disabled>Focus here</button>
            </div>
          </aside>
        </main>
      </div>`;

export const WORKSPACE_BODY = `
      <div class="visp-shell workspace-shell">
        <div class="workspace-search">
          <label class="search-field">
            <span class="sr-only">Search notes and tasks</span>
            <span class="codicon codicon-search" aria-hidden="true"></span>
            <input id="workspace-filter" type="search" placeholder="Search notes and tasks"
              autocomplete="off" aria-describedby="workspace-filter-status">
            <button id="workspace-search" class="workspace-search-key" type="button"
              title="Search the text of every note">Find</button>
          </label>
          <p id="workspace-filter-status" class="sr-only" aria-live="polite"></p>
        </div>
        <div id="workspace-error" class="notice notice-error" role="alert" hidden></div>
        <div id="workspace-body" class="workspace-body view-body">
          <h2 class="section-rule workspace-section">
            <span class="eyebrow">Views</span>
          </h2>
          <div id="workspace-views" class="workspace-views"></div>
          <h2 class="section-rule workspace-section">
            <span class="eyebrow">Notes</span>
            <span id="workspace-note-count" class="section-count">0</span>
          </h2>
          <div id="workspace-notes" class="workspace-notes"></div>
          <h2 class="section-rule workspace-section">
            <span class="eyebrow">Tags</span>
          </h2>
          <div id="workspace-tags" class="workspace-tags"></div>
        </div>
        <footer id="workspace-status" class="workspace-status">
          <span id="workspace-status-dot" class="workspace-status-dot"></span>
          <span id="workspace-status-text">Waiting for index…</span>
          <span id="workspace-status-indexed" class="workspace-status-indexed"></span>
        </footer>
        <div id="workspace-menu" class="workspace-menu" role="menu" aria-label="Note actions" hidden>
          <p id="workspace-menu-note" class="workspace-menu-note"></p>
          <button class="workspace-menu-item" type="button" role="menuitem" data-action="rename">
            <span class="codicon codicon-edit" aria-hidden="true"></span>
            <span class="workspace-menu-label">Rename Note…</span>
          </button>
          <button class="workspace-menu-item" type="button" role="menuitem" data-action="graph">
            <span class="codicon codicon-type-hierarchy" aria-hidden="true"></span>
            <span class="workspace-menu-label">Open Local Graph</span>
          </button>
          <button class="workspace-menu-item is-destructive" type="button" role="menuitem" data-action="delete">
            <span class="codicon codicon-trash" aria-hidden="true"></span>
            <span class="workspace-menu-label">Delete Note…</span>
          </button>
        </div>
      </div>`;
