import { createWebviewPage } from "./webviewPage";
import { EDITOR_BODY } from "./pageBodies";
import type { WebviewTemplateOptions } from "./webviewPage";

/**
 * The note editor.
 *
 * One header row carries everything the document needs said about it — what it is, where it
 * lives, how it is tagged, whether it is saved — and the actions that are not keyboard-first
 * move into an overflow menu. Everything below the header is either the note or the
 * inspector beside it, so the prose keeps the whole measure it is given.
 */
export function createEditorHtml(options: WebviewTemplateOptions): string {
  return createWebviewPage(options, {
    title: "Visp Notes Editor",
    styles: ["base.css", "editor.css", "editor-drafts.css"],
    script: "scripts/editor.js",
    body: EDITOR_BODY,
  });
}
