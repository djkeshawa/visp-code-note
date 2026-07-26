import { createWebviewPage } from "./webviewPage";
import type { WebviewTemplateOptions } from "./webviewPage";

export function createTasksHtml(options: WebviewTemplateOptions): string {
  return createWebviewPage(options, {
    title: "Visp Notes Tasks",
    styles: ["base.css", "tasks.css"],
    script: "scripts/tasks.js",
    body: `
      <div class="visp-shell tasks-shell">
        <header class="view-toolbar tasks-toolbar">
          <div class="title-stack">
            <span class="eyebrow">Workspace</span>
            <h1 id="task-view-title" class="toolbar-title">Tasks</h1>
          </div>
          <div class="toolbar-spacer"></div>
          <label class="search-field">
            <span class="sr-only">Filter tasks</span>
            <span class="codicon codicon-search" aria-hidden="true"></span>
            <input id="task-search" type="search" placeholder="Filter tasks" autocomplete="off">
          </label>
          <label class="select-field">
            <span class="sr-only">Task status</span>
            <select id="task-status">
              <option value="open">Open tasks</option>
              <option value="all">All tasks</option>
              <option value="completed">Completed</option>
            </select>
          </label>
          <label class="select-field" title="Group tasks by">
            <span class="codicon codicon-list-tree" aria-hidden="true"></span>
            <span class="sr-only">Group tasks by</span>
            <select id="task-group-by">
              <option value="due">By due date</option>
              <option value="note">By note</option>
              <option value="tag">By tag</option>
            </select>
          </label>
        </header>
        <div id="tasks-error" class="notice notice-error" role="alert" hidden></div>
        <main id="task-groups" class="task-groups" aria-live="polite"></main>
        <footer class="view-footer">
          <span id="task-count">Waiting for index…</span>
          <span class="footer-hint">Select a task title to open its note</span>
        </footer>
      </div>`,
  });
}
