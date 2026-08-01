import { createWebviewPage } from "./webviewPage";
import { WORKSPACE_BODY } from "./pageBodies";
import type { WebviewTemplateOptions } from "./webviewPage";

/**
 * The workspace panel.
 *
 * A webview rather than a `TreeView` because the design is a panel, not a tree: it puts a
 * search field inside itself, labels its sections with a rule rather than a twisty, gives every
 * tag a colour and every note a connectedness dot, and closes with a status line. A TreeView
 * offers a label, an icon, a description and a checkbox, and no way to draw any of that.
 */
export function createWorkspaceHtml(options: WebviewTemplateOptions): string {
  return createWebviewPage(options, {
    title: "Visp Notes Workspace",
    styles: ["base.css", "workspace.css"],
    script: "scripts/workspace.js",
    body: WORKSPACE_BODY,
  });
}
