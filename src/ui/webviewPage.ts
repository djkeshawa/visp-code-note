import { randomBytes } from "node:crypto";
import { Uri } from "vscode";
import type { Webview } from "vscode";

export interface WebviewTemplateOptions {
  readonly webview: Webview;
  readonly extensionUri: Uri;
}

export interface WebviewPageDefinition {
  readonly title: string;
  readonly styles: readonly string[];
  readonly script: string;
  readonly body: string;
}

export function createWebviewPage(
  options: WebviewTemplateOptions,
  definition: WebviewPageDefinition,
): string {
  const nonce = randomBytes(18).toString("base64");
  const styleLinks = definition.styles
    .map((file) => assetUri(options, file))
    .map((uri) => `<link rel="stylesheet" href="${escapeAttribute(uri)}">`)
    .join("\n    ");
  const scriptUri = assetUri(options, definition.script);
  const csp = [
    "default-src 'none'",
    `img-src ${options.webview.cspSource} data:`,
    `font-src ${options.webview.cspSource}`,
    `style-src ${options.webview.cspSource} 'nonce-${nonce}'`,
    `script-src ${options.webview.cspSource} 'nonce-${nonce}'`,
  ].join("; ");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="${escapeAttribute(csp)}">
    <title>${escapeText(definition.title)}</title>
    ${styleLinks}
  </head>
  <body data-csp-nonce="${escapeAttribute(nonce)}">
    ${definition.body}
    <script nonce="${nonce}" type="module" src="${escapeAttribute(scriptUri)}"></script>
  </body>
</html>`;
}

function assetUri(options: WebviewTemplateOptions, relativePath: string): string {
  const segments = relativePath.split("/").filter(Boolean);
  return options.webview.asWebviewUri(Uri.joinPath(options.extensionUri, "media", ...segments)).toString();
}

function escapeText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeAttribute(value: string): string {
  return escapeText(value).replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
