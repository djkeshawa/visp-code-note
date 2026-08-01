import type { IndexSnapshot } from "../domain/models";
import { getBrokenLinks, getOrphanNotes } from "../indexing/projections";

/**
 * The note lists the workspace panel offers, as rows.
 *
 * Orphan notes and broken links used to be shown through a quick pick — a dropdown over the
 * command palette, a dozen rows tall, gone the moment it lost focus. Neither is a thing you
 * glance at: they are lists you work through, comparing one row against the next, so they
 * belong in the window rather than over it.
 */

export type NoteListMode = "orphans" | "broken";

export interface NoteListRow {
  /** The note the row opens. */
  readonly uri: string;
  readonly title: string;
  readonly path: string;
  /** For a broken link, the target that lands nowhere. */
  readonly detail?: string;
  /** Where in the note to scroll to, when the row is about a place rather than a file. */
  readonly start?: number;
  /** One-based, as a reader counts them. */
  readonly line?: number;
}

export function buildNoteListing(
  snapshot: IndexSnapshot,
  mode: NoteListMode,
): readonly NoteListRow[] {
  return mode === "orphans" ? orphanRows(snapshot) : brokenRows(snapshot);
}

/** What the panel says when a list is empty — which, for both of these, is good news. */
export function emptyListingMessage(mode: NoteListMode): string {
  return mode === "orphans"
    ? "Every note is connected to another."
    : "Every wiki link lands somewhere.";
}

export function listingTitle(mode: NoteListMode): string {
  return mode === "orphans" ? "Orphan Notes" : "Broken Links";
}

function orphanRows(snapshot: IndexSnapshot): readonly NoteListRow[] {
  return getOrphanNotes(snapshot)
    .map((note): NoteListRow => ({ uri: note.uri, title: note.title, path: note.path }))
    .sort(byPath);
}

function brokenRows(snapshot: IndexSnapshot): readonly NoteListRow[] {
  const notes = new Map(snapshot.notes.map((note) => [note.uri, note]));
  const rows: NoteListRow[] = [];
  for (const broken of getBrokenLinks(snapshot)) {
    const note = notes.get(broken.sourceUri);
    if (note === undefined) continue;
    rows.push({
      uri: note.uri,
      title: note.title,
      path: note.path,
      detail: broken.link.raw,
      start: broken.link.range.start,
      line: lineOf(note.content, broken.link.range.start),
    });
  }
  return rows.sort((left, right) => byPath(left, right) || (left.start ?? 0) - (right.start ?? 0));
}

function byPath(left: NoteListRow, right: NoteListRow): number {
  return left.path.localeCompare(right.path, undefined, { sensitivity: "base" }) ||
    left.title.localeCompare(right.title, undefined, { sensitivity: "base" });
}

/** One-based line number of an offset, counted the way an editor's gutter counts. */
function lineOf(content: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset && index < content.length; index += 1) {
    if (content[index] === "\n") line += 1;
  }
  return line;
}
