import { posix } from "node:path";
import * as vscode from "vscode";
import type { NoteRelocation } from "../application/linkMigration";
import { planRelocationMigration } from "../application/linkMigration";
import type { IndexSnapshot, NoteRecord } from "../domain/models";
import { noteStem } from "../domain/normalization";
import { writtenTitle } from "../markdown/parser";
import { planLinkReplacementEdit } from "../vscode/documentEdits";
import { isIndexableMarkdown, readNoteRecord } from "./discovery";

export interface FileRename {
  readonly oldUri: vscode.Uri;
  readonly newUri: vscode.Uri;
}

/**
 * The link rewrites an Explorer rename needs, ready to ride along with the rename itself.
 *
 * Renaming a note from the Explorer, or dragging it into another folder, is the most ordinary
 * gesture there is, and until this existed it moved the file and left every `[[Old Title]]` in
 * the vault pointing at nothing, silently. This is the same migration the Rename Note command
 * runs, planned from the same index and validated against the same document text — the only
 * difference is that nothing here is allowed to ask the user anything.
 *
 * Returns `undefined` when there is nothing to rewrite, which is the common case: a note that
 * writes down its own title keeps it through a rename, so its incoming links never move.
 */
export async function planFileRenameEdit(
  snapshot: IndexSnapshot,
  renames: readonly FileRename[],
): Promise<vscode.WorkspaceEdit | undefined> {
  const relocations = await relocationsFor(snapshot, renames);
  if (relocations.length === 0) return undefined;
  const replacements = planRelocationMigration(snapshot, relocations);
  if (replacements.length === 0) return undefined;
  return planLinkReplacementEdit(replacements);
}

async function relocationsFor(
  snapshot: IndexSnapshot,
  renames: readonly FileRename[],
): Promise<readonly NoteRelocation[]> {
  const notesByUri = new Map(snapshot.notes.map((note) => [note.uri, note]));
  const relocations: NoteRelocation[] = [];
  for (const rename of renames) {
    const note = notesByUri.get(rename.oldUri.toString());
    if (note) {
      relocations.push(relocationFor(note, rename.newUri));
      continue;
    }
    const inside = notesUnder(snapshot, rename.oldUri);
    if (inside.length > 0) {
      /*
       * A folder. VS Code fires one event for a moved folder rather than one per file inside
       * it, so every note under it has to be relocated here or a folder drag rewrites nothing.
       */
      for (const moved of inside) {
        relocations.push(relocationFor(moved, movedUnder(rename, moved.uri)));
      }
      continue;
    }
    const arrival = await arrivingNote(rename);
    if (arrival) relocations.push({ next: arrival });
  }
  return relocations;
}

function relocationFor(note: NoteRecord, newUri: vscode.Uri): NoteRelocation {
  /*
   * A note dragged into an excluded folder, or renamed to something that is no longer Markdown,
   * leaves the index. There is no name a link could be rewritten to that would still reach it,
   * so `planRelocationMigration` leaves those links as the user wrote them.
   */
  return isIndexableMarkdown(newUri)
    ? { previous: note, next: relocated(note, newUri) }
    : { previous: note };
}

/**
 * The record the same note will have once the rename lands.
 *
 * A new object every time: records are immutable and shared with every consumer holding the
 * current snapshot, so the post-rename projection must never be built by editing one.
 */
function relocated(note: NoteRecord, newUri: vscode.Uri): NoteRecord {
  const fileName = posix.basename(newUri.path);
  return {
    ...note,
    uri: newUri.toString(),
    path: workspacePath(newUri),
    fileName,
    title: writtenTitle(note) ?? noteStem(fileName),
  };
}

/** Notes the rename moves as passengers, because their folder is what was actually renamed. */
function notesUnder(snapshot: IndexSnapshot, folderUri: vscode.Uri): readonly NoteRecord[] {
  const prefix = `${folderUri.toString()}/`;
  return snapshot.notes.filter((note) => note.uri.startsWith(prefix));
}

function movedUnder(rename: FileRename, noteUri: string): vscode.Uri {
  return vscode.Uri.parse(rename.newUri.toString() + noteUri.slice(rename.oldUri.toString().length));
}

/**
 * A file that becomes a note — `notes.txt` renamed to `notes.md`.
 *
 * Nothing pointed at it before, so it needs no rewrites of its own; it is read so that the
 * post-rename workspace knows the name it arrives under. Arriving under a name another note
 * already answers to is exactly the case that would otherwise re-point that note's links.
 */
async function arrivingNote(rename: FileRename): Promise<NoteRecord | undefined> {
  if (!isIndexableMarkdown(rename.newUri)) return undefined;
  try {
    // The file is still at its old path: this runs before VS Code performs the rename.
    const record = await readNoteRecord(rename.oldUri);
    return record ? relocated(record, rename.newUri) : undefined;
  } catch {
    return undefined;
  }
}

function workspacePath(uri: vscode.Uri): string {
  const includeRoot = (vscode.workspace.workspaceFolders?.length ?? 0) > 1;
  return vscode.workspace.asRelativePath(uri, includeRoot).replace(/\\/g, "/");
}
