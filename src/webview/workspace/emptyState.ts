import type { WorkspaceMenuCommandWire } from "../contracts.js";

/** The one thing an empty panel offers to do about itself, if there is one. */
export interface WorkspaceEmptyAction {
  readonly label: string;
  /**
   * Typed to the panel's command set rather than to a string, so an empty state cannot name
   * a command the host has not agreed to run.
   */
  readonly command: WorkspaceMenuCommandWire;
}

export interface WorkspaceEmptyState {
  readonly icon: string;
  readonly message: string;
  readonly hint?: string;
  readonly action?: WorkspaceEmptyAction;
}

/**
 * What the Notes list says when it has nothing to list.
 *
 * This is the first sentence the product says to a new reader, and it used to be the wrong
 * one: an empty folder was told to open a folder holding Markdown files, which is the thing
 * that had just been done, with no way to act on it. Whether a folder is open at all is the
 * difference between the two cases — one is answered outside this panel, by VS Code's own
 * Open Folder, and the other is answered here, by writing the first note.
 *
 * Returns nothing when there are notes, because then the list speaks for itself.
 */
export function workspaceEmptyState(
  hasWorkspaceFolder: boolean,
  noteCount: number,
): WorkspaceEmptyState | undefined {
  if (noteCount > 0) return undefined;
  if (!hasWorkspaceFolder) {
    /*
     * No action button here on purpose: opening a folder is VS Code's own command, and the
     * panel's command set is deliberately this extension's own commands only.
     */
    return {
      icon: "folder",
      message: "No folder is open.",
      hint: "Open a folder, and every Markdown file in it becomes a note here.",
    };
  }
  return {
    icon: "note",
    message: "No notes here yet.",
    hint: "A note is a plain Markdown file in this folder.",
    action: { label: "Create your first note", command: "newNote" },
  };
}
