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
          <h1 id="backlinks-title">No note selected</h1>
          <div id="backlinks-stats" class="backlinks-stats" aria-label="Note connections"></div>
        </header>
        <main>
          <h2 id="mentions-label" class="section-heading">Linked mentions</h2>
          <div id="backlinks-list" class="backlinks-list" aria-live="polite"></div>
        </main>
      </div>`,
  });
}
