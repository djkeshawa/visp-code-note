import * as vscode from "vscode";
import type { CommandIndex } from "./contracts";
import { activeMarkdownUri, coerceUri } from "./commandUtils";

/**
 * Deleting a note from inside Visp Notes.
 *
 * The workspace panel is a webview, so VS Code's own Explorer context menu — and the Delete on
 * it — never reaches these rows. Right-clicking a note offered a rename and a graph and no way
 * to get rid of it, which meant leaving the panel for the file Explorer to do the one thing the
 * panel is otherwise the fastest place to do.
 *
 * A note is not a file like any other: other notes link to it, and those links break. The
 * confirmation says how many, because that is the number that decides whether this is a
 * housekeeping delete or one that costs something.
 */

const MOVE_TO_TRASH = "Move to Trash";
const DELETE_PERMANENTLY = "Delete Permanently";

/**
 * A fully specified delete, supplied as the command argument.
 *
 * Passing `confirmed` skips the modal, which is what makes this drivable from a test — a modal
 * cannot be answered from one. It is deliberately not something the webview can send: the panel
 * posts a URI and nothing else, so the confirmation always happens for a real reader.
 */
export interface DeleteNoteRequest {
  readonly uri?: unknown;
  readonly confirmed: true;
}

function asDeleteRequest(value: unknown): DeleteNoteRequest | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as Partial<DeleteNoteRequest>;
  return candidate.confirmed === true ? { uri: candidate.uri, confirmed: true } : undefined;
}

export async function deleteNote(index: CommandIndex, value?: unknown): Promise<void> {
  const request = asDeleteRequest(value);
  const requestedUri = request === undefined
    ? coerceUri(value)
    : request.uri === undefined ? undefined : coerceUri(request.uri);
  const uri = requestedUri ?? activeMarkdownUri();
  const note = uri ? index.findNote(uri) : undefined;
  if (!uri || !note) {
    void vscode.window.showInformationMessage("Open or select an indexed Markdown note to delete it.");
    return;
  }

  const backlinks = new Set(
    index.snapshot.backlinks
      .filter((backlink) => backlink.targetUri === note.uri)
      .map((backlink) => backlink.sourceUri),
  ).size;

  if (request === undefined && !(await confirm(note.title, note.path, backlinks))) return;

  /*
   * Editors close first, and a delete that the reader then cancels at a save prompt is
   * abandoned. Deleting underneath an open tab left VS Code holding a buffer for a file that
   * no longer existed, and a dirty note would have prompted to save it after the fact.
   */
  if (!(await closeEditorsFor(uri))) {
    void vscode.window.showInformationMessage(`“${note.title}” was not deleted.`);
    return;
  }
  if (!(await removeFile(uri))) return;
  await index.refresh(uri);
}

async function confirm(title: string, path: string, backlinks: number): Promise<boolean> {
  const detail = backlinks === 0
    ? `${path} will be moved to the trash.`
    : `${path} will be moved to the trash. ${backlinks} note${backlinks === 1 ? "" : "s"} ` +
      `link${backlinks === 1 ? "s" : ""} to it, and ` +
      `${backlinks === 1 ? "that link" : "those links"} will break.`;
  const choice = await vscode.window.showWarningMessage(
    `Delete “${title}”?`,
    { modal: true, detail },
    MOVE_TO_TRASH,
  );
  return choice === MOVE_TO_TRASH;
}

/**
 * Moves the note to the trash, asking a second time before deleting outright.
 *
 * Not every file system has a trash — a remote workspace or a container often does not — and
 * VS Code reports that by refusing the operation rather than silently deleting. Falling through
 * to a permanent delete without asking would turn a recoverable action into an unrecoverable
 * one on exactly the machines where the reader is least likely to expect it.
 *
 * Which failure it was matters, though. Every `FileSystemError` used to be reported as a
 * missing trash, so a note the reader had no permission to remove offered them a permanent
 * delete that could not have worked either — and said something untrue about their machine on
 * the way. Only an unrecognised failure is treated as the trash being unavailable.
 */
async function removeFile(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.delete(uri, { useTrash: true, recursive: false });
    return true;
  } catch (error) {
    if (!(error instanceof vscode.FileSystemError)) throw error;
    if (error.code === "FileNotFound") return true; // Already gone; the index still needs to hear.
    if (error.code === "NoPermissions") {
      void vscode.window.showErrorMessage(
        `Visp Notes cannot delete ${uri.fsPath}: permission denied.`,
      );
      return false;
    }
    const choice = await vscode.window.showWarningMessage(
      "This file could not be moved to the trash.",
      {
        modal: true,
        detail: `${uri.fsPath}\n\n${error.message}\n\nIt can still be deleted permanently, ` +
          "which cannot be undone.",
      },
      DELETE_PERMANENTLY,
    );
    if (choice !== DELETE_PERMANENTLY) return false;
    await vscode.workspace.fs.delete(uri, { useTrash: false, recursive: false });
    return true;
  }
}

/**
 * Closes any tab showing the note, reporting whether they all went.
 *
 * A dirty note raises a save prompt, and the reader may cancel it — which has to cancel the
 * delete too, rather than throwing away the edit they just declined to lose.
 */
async function closeEditorsFor(uri: vscode.Uri): Promise<boolean> {
  const target = uri.toString();
  const tabs = vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .filter((tab) => tabUri(tab)?.toString() === target);
  return tabs.length === 0 || await vscode.window.tabGroups.close(tabs, false);
}

function tabUri(tab: vscode.Tab): vscode.Uri | undefined {
  const input: unknown = tab.input;
  if (typeof input !== "object" || input === null || !("uri" in input)) return undefined;
  const candidate = (input as { readonly uri: unknown }).uri;
  return candidate instanceof vscode.Uri ? candidate : undefined;
}
