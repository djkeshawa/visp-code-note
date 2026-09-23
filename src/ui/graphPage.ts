import { createWebviewPage } from "./webviewPage";
import { GRAPH_BODY } from "./pageBodies";
import type { WebviewTemplateOptions } from "./webviewPage";

/** The graph keeps filters above the canvas and shows a results pane only during search. */
export function createGraphHtml(options: WebviewTemplateOptions): string {
  return createWebviewPage(options, {
    title: "Visp Notes Graph",
    styles: ["base.css", "fonts.css", "graph.css", "graph-search.css"],
    script: "scripts/graph.js",
    body: GRAPH_BODY,
  });
}
