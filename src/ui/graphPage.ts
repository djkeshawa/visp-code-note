import { createWebviewPage } from "./webviewPage";
import { GRAPH_BODY } from "./pageBodies";
import type { WebviewTemplateOptions } from "./webviewPage";

/**
 * The knowledge graph.
 *
 * The graph is the content, so it gets the whole pane and every control floats over it:
 * filters top-left, viewport bottom-left, the selected node bottom-right. Docking those into
 * side columns cost the drawing roughly a third of its width to say things that are only
 * looked at occasionally.
 */
export function createGraphHtml(options: WebviewTemplateOptions): string {
  return createWebviewPage(options, {
    title: "Visp Notes Graph",
    styles: ["base.css", "graph.css"],
    script: "scripts/graph.js",
    body: GRAPH_BODY,
  });
}
