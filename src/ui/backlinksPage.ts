import { createWebviewPage } from "./webviewPage";
import type { WebviewTemplateOptions } from "./webviewPage";

export function createBacklinksHtml(options: WebviewTemplateOptions): string {
  return createWebviewPage(options, {
    title: "Visp Notes Backlinks",
    styles: ["base.css", "backlinks.css"],
    script: "scripts/backlinks.js",
    body: `
      <div class="visp-shell backlinks-shell">
        <header class="backlinks-header">
          <span class="eyebrow">Linked mentions</span>
          <h1 id="backlinks-title">Backlinks</h1>
        </header>
        <section class="backlink-summary" aria-label="Note connection summary">
          <div><strong id="backlinks-count">0</strong><span>Backlinks</span></div>
          <div><strong id="outgoing-count">0</strong><span>Links out</span></div>
          <div><strong id="inline-task-count">0</strong><span>Tasks</span></div>
        </section>
        <main>
          <div class="section-heading">
            <h2>Mentions</h2>
            <span id="mentions-label" class="muted">Waiting for note…</span>
          </div>
          <div id="backlinks-list" class="backlinks-list" aria-live="polite"></div>
        </main>
      </div>`,
  });
}
