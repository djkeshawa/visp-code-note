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
          <div class="title-stack">
            <span class="eyebrow">Visp note</span>
            <h1 id="note-title" class="toolbar-title">Loading note…</h1>
          </div>
          <div class="toolbar-spacer"></div>
          <button id="insert-link" class="secondary-button editor-link-button" type="button" title="Insert a wiki link (Ctrl/Cmd+Shift+L)" disabled>
            <span aria-hidden="true">↗</span> Link
          </button>
          <button id="save-note" class="primary-button editor-save-button" type="button" title="Save note (Ctrl/Cmd+S)" disabled>
            Save
          </button>
          <div class="segmented-control" role="group" aria-label="Editor mode">
            <button id="live-mode" class="segment is-active" type="button" aria-pressed="true">Live</button>
            <button id="markdown-mode" class="segment" type="button" aria-pressed="false">Markdown</button>
          </div>
        </header>
        <div id="editor-error" class="notice notice-error" role="alert" hidden></div>
        <div id="editor-conflict" class="notice notice-warning draft-conflict" role="alert" aria-atomic="true" hidden></div>
        <main class="editor-content">
          <div id="editor-host" class="editor-host is-live-mode" aria-describedby="editor-hint sync-status"></div>
        </main>
        <footer class="view-footer">
          <span id="sync-status" class="sync-status" role="status" aria-live="polite" aria-atomic="true">Loading note…</span>
          <span id="editor-version" class="editor-version">Waiting for document…</span>
          <span id="editor-hint" class="footer-hint">Type anywhere · Ctrl/Cmd+S to save · Ctrl/Cmd-click or Ctrl/Cmd+Enter to open a link</span>
        </footer>
      </div>`,
  });
}
