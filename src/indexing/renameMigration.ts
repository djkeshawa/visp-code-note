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
 *
 * It runs under VS Code's participant timeout, so the cost is worth stating: every link in the
 * workspace is re-resolved, which measured 55ms at 2,000 notes and 4,000 links on this machine
 * and 211ms at 4,000 notes and 40,000 links. Renaming something that is not a note and holds no
 * notes returns before any of that. Nothing here is deferred or debounced — a rename the user is
 * waiting on is the wrong place to be clever, and these are the numbers that say it need not be.
 */
export async function planFileRenameEdit(
  snapshot: IndexSnapshot,
  renames: readonly FileRename[],
): Promise<vscode.WorkspaceEdit | undefined> {
  if (suppressed > 0 || !linkMigrationEnabled()) return undefined;
  const relocations = await relocationsFor(snapshot, renames);
  if (relocations.length === 0) return undefined;
  const plan = planRelocationMigration(snapshot, relocations);
  if (plan.replacements.length === 0) return undefined;
  await confirmPlanNotesExist(plan.dependsOn, relocations);
  return planLinkReplacementEdit(plan.replacements);
}

const MIGRATION_SETTING = "vispNotes.updateLinksOnFileMove.enabled";

/**
 * Whether the reader has agreed to this at all — the decision this participant shipped without.
 *
 * It is the only thing the extension writes to files nobody opened, and it happens during a
 * gesture the reader believes is a file rename, so being able to find out in advance that a
 * drag edits other notes is not optional. Three ways were on the table and two are taken here.
 *
 * The setting, first, and shaped like `markdown.updateLinksOnFileMove.enabled` because that is
 * the convention a VS Code user already has an opinion about — same suffix, same values, same
 * place in the settings search. With one difference: no `prompt`. VS Code's own version can
 * offer it because it does its asking outside the participant; this handler *is* the
 * participant, running under `files.participants.timeout` with a spinner over the Explorer, so
 * a question here is a hung rename rather than a question. Offering a value that would have to
 * time out into one answer or the other would be worse than not offering it.
 *
 * Second, and the reason the default stays `always`: the migration no longer rewrites prose.
 * `preservedLinkText` keeps the word the link puts on the page and moves only what it points
 * at, so what this setting now switches off is a repair, not an edit to anyone's sentences.
 * `README.md` says the same thing where a reader looks before installing rather than after.
 *
 * Read per call rather than cached: it is one `getConfiguration` against a value VS Code
 * already has in memory, and a rename is not where a stale copy of a consent flag belongs.
 */
function linkMigrationEnabled(): boolean {
  return vscode.workspace.getConfiguration().get<string>(MIGRATION_SETTING) !== "never";
}

/**
 * Refuses the plan unless every note it named is still on disk.
 *
 * The document check in `planReplacementDocuments` asks whether the link *text* has moved since
 * the index read it. That is only half of what the index can be behind on. It can also be behind
 * on layout — a folder renamed a moment ago whose rebuild has not committed, a `git checkout`, an
 * external tool — and a rewrite that re-pins a link to a path asserts that the file at that path
 * exists. Two ordinary Explorer gestures in a row were enough to write a permanently dead link
 * into a note the user never opened: rename a folder, then, before the rebuild lands, rename a
 * note whose name the stale snapshot still says is taken.
 *
 * Only the notes actually written down are checked, not the whole projection, so this is a
 * handful of parallel stats rather than a vault walk — and it runs before any document is opened,
 * so the expensive half of the plan is never paid for a plan that is about to be thrown away.
 * Throwing here lands in the handler's existing all-or-nothing path: no edit, one warning, and
 * the rename itself still goes through.
 */
async function confirmPlanNotesExist(
  dependsOn: readonly NoteRecord[],
  relocations: readonly NoteRelocation[],
): Promise<void> {
  const stillAt = new Map<string, string>();
  const arriving = new Set<string>();
  for (const { previous, next } of relocations) {
    if (!next) continue;
    // A note that is moving is still at its old path: none of this has happened yet.
    if (previous) stillAt.set(next.uri, previous.uri);
    else arriving.add(next.uri);
  }
  await Promise.all(dependsOn.map(async (note) => {
    // An arriving file was just read from disk by `arrivingNote`, so it needs no second look.
    if (arriving.has(note.uri)) return;
    await vscode.workspace.fs.stat(vscode.Uri.parse(stillAt.get(note.uri) ?? note.uri));
  }));
}

let suppressed = 0;

/**
 * Runs an operation that renames files itself, without the Explorer participant joining in.
 *
 * `applyEdit` with a `renameFile` in it fires `onWillRenameFiles` exactly as a drag in the
 * Explorer does, and VS Code has no way to say which extension asked. Without this, the Rename
 * Note command's own rename gets migrated twice — once by the participant, once by the
 * transaction that planned it — and the transaction's "has this file changed since the preview"
 * check then fails on the participant's own work, after the file has already moved. The command
 * plans a mode, a title change and an alias the participant knows nothing about, so the right
 * one to switch off is the participant.
 */
export async function withoutRenameParticipation<T>(operation: () => Promise<T>): Promise<T> {
  suppressed += 1;
  try {
    return await operation();
  } finally {
    suppressed -= 1;
  }
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
    const read = await readNoteRecord(rename.oldUri);
    /*
     * An oversized file is skipped by the index after the rename just as it was before, so the
     * post-rename workspace must not learn a name for it. Letting one in would re-point other
     * notes' links at a file the resolver cannot reach.
     */
    return read.kind === "note" ? relocated(read.note, rename.newUri) : undefined;
  } catch {
    return undefined;
  }
}

function workspacePath(uri: vscode.Uri): string {
  const includeRoot = (vscode.workspace.workspaceFolders?.length ?? 0) > 1;
  return vscode.workspace.asRelativePath(uri, includeRoot).replace(/\\/g, "/");
}
