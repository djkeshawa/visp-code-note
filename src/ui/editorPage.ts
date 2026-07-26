import { createWebviewPage } from "./webviewPage";
import type { WebviewTemplateOptions } from "./webviewPage";

export function createEditorHtml(options: WebviewTemplateOptions): string {
  return createWebviewPage(options, {
    title: "Visp Notes Editor",
    styles: ["base.css", "editor.css", "editor-drafts.css"],
    script: "scripts/editor.js",
    body: `
      <div class="visp-shell editor-shell">
        <header class="view-toolbar editor-toolbar">
          <h1 id="note-title" class="toolbar-title">Loading note…</h1>
          <div class="toolbar-spacer"></div>
          <button id="insert-link" class="secondary-button editor-link-button" type="button" title="Insert a wiki link (Ctrl/Cmd+Shift+L)" disabled>
            <span class="codicon codicon-link" aria-hidden="true"></span> Link
          </button>
          <button id="retry-sync" class="secondary-button editor-retry-button" type="button" title="Retry the change that could not be applied" hidden>
            <span class="codicon codicon-refresh" aria-hidden="true"></span> Retry
          </button>
          <div class="segmented-control" role="group" aria-label="Editor mode">
            <button id="live-mode" class="segment is-active" type="button" aria-pressed="true">Live</button>
            <button id="markdown-mode" class="segment" type="button" aria-pressed="false">Markdown</button>
          </div>
        </header>
        <div class="note-context">
          <nav id="note-breadcrumb" class="note-breadcrumb" aria-label="Note location"></nav>
          <span id="note-tags" class="note-tags"></span>
          <span id="note-stats" class="note-stats"></span>
          <label class="select-field editor-width-field" title="Note content width">
            <span class="codicon codicon-layout" aria-hidden="true"></span>
            <span class="sr-only">Note content width</span>
            <select id="editor-width">
              <option value="readable">Readable</option>
              <option value="wide">Wide</option>
              <option value="full">Full</option>
            </select>
          </label>
        </div>
        <div id="editor-error" class="notice notice-error" role="alert" hidden></div>
        <div id="editor-conflict" class="notice notice-warning draft-conflict" role="alert" aria-atomic="true" hidden></div>
        <main class="editor-content">
          <div id="editor-host" class="editor-host is-live-mode" aria-describedby="editor-hint sync-status"></div>
        </main>
        <footer class="view-footer">
          <span id="sync-status" class="sync-status" role="status" aria-live="polite" aria-atomic="true">
            <span id="sync-status-icon" class="codicon codicon-circle-large-outline" aria-hidden="true"></span>
            <span id="sync-status-text">Loading note…</span>
          </span>
          <span id="editor-hint" class="footer-hint">Ctrl/Cmd+S saves · Ctrl/Cmd-click opens a link</span>
        </footer>
      </div>`,
  });
}
