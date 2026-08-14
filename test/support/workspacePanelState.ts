import type { WorkspacePanelState } from "../../src/domain/protocol";
import { folderTreeRows } from "../../src/application/workspaceFolderTree";

/**
 * A panel state built the way the host builds one, from nothing but a list of note paths — so
 * that a test says what the vault looks like and not what the wire looks like.
 */
export function panelState(
  paths: readonly string[],
  overrides: Partial<WorkspacePanelState> = {},
): WorkspacePanelState {
  const notes = [...paths].sort().map((path) => ({
    uri: `file:///vault/${path}`,
    title: titleOf(path),
    path,
    folder: path.split("/").slice(0, -1).join("/"),
    links: 0,
  }));
  return {
    density: "comfortable",
    hasWorkspaceFolder: true,
    views: [
      { id: "due", label: "Due Today", icon: "calendar", count: 0, tone: "default" },
      { id: "tasks", label: "All Tasks", icon: "checklist", count: 0, tone: "default" },
    ],
    dueToday: [],
    folders: folderTreeRows(notes),
    notes,
    tags: [],
    noteCount: notes.length,
    taskCount: 0,
    skippedOversized: [],
    indexedAt: Date.parse("2026-08-15T09:00:00Z"),
    status: "idle",
    version: 1,
    ...overrides,
  };
}

/** The stem, title-cased the way a note with no heading is named after its file. */
function titleOf(path: string): string {
  const stem = (path.split("/").at(-1) ?? path).replace(/\.md$/, "");
  return stem.charAt(0).toLocaleUpperCase() + stem.slice(1);
}
