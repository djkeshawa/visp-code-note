import { createWebviewPage } from "./webviewPage";
import { NOTES_BODY } from "./pageBodies";
import type { WebviewTemplateOptions } from "./webviewPage";

/**
 * Orphan notes, and links that land nowhere.
 *
 * Both were quick picks — a dropdown over the palette, gone the moment it lost focus. Neither
 * is glanced at: they are lists you work through, so they get the window and the same toolbar,
 * filter field and footer every other view here has.
 */
export function createNotesHtml(options: WebviewTemplateOptions): string {
  return createWebviewPage(options, {
    title: "Visp Notes",
    styles: ["base.css", "notes.css"],
    script: "scripts/notes.js",
    body: NOTES_BODY,
  });
}
