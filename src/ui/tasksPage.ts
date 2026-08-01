import { createWebviewPage } from "./webviewPage";
import { TASKS_BODY } from "./pageBodies";
import type { WebviewTemplateOptions } from "./webviewPage";

/**
 * The workspace task list.
 *
 * A task is one line of a note, so it is drawn as one row: what it says, which note it came
 * from, when it is due. Rows are dense enough that a week of work fits on one screen, which
 * is the only way a list like this gets read at all.
 */
export function createTasksHtml(options: WebviewTemplateOptions): string {
  return createWebviewPage(options, {
    title: "Visp Notes Tasks",
    styles: ["base.css", "tasks.css"],
    script: "scripts/tasks.js",
    body: TASKS_BODY,
  });
}
