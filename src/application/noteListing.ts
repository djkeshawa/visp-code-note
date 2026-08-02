import type { IndexSnapshot } from "../domain/models";
import { getBrokenLinks, getOrphanNotes } from "../indexing/projections";

/**
 * The note lists the workspace panel offers, as rows.
 *
 * Orphan notes, broken links and a tag's notes were all reached through a quick pick — a
 * dropdown over the command palette, a dozen rows tall, gone the moment it lost focus. None of
 * them is a thing you glance at: they are lists you work through, comparing one row against the
 * next, so they belong in the window rather than over it.
 */

/**
 * Which list the panel is showing.
 *
 * A union rather than a bare mode because a tag listing needs to say *which* tag, and passing
 * that alongside a mode string would let the two disagree.
 */
export type NoteListing =
  | { readonly kind: "orphans" }
  | { readonly kind: "broken" }
  | { readonly kind: "tag"; readonly tag: string };

export type NoteListKind = NoteListing["kind"];

export interface NoteListRow {
  /** The note the row opens. */
  readonly uri: string;
  readonly title: string;
  readonly path: string;
  /** For a broken link, the target that lands nowhere. */
  readonly detail?: string;
  /**
   * The note's other tags, for a tag listing. Names rather than one joined string, because
   * each is drawn in its own hue and a hue is derived from the name.
   */
  readonly tags?: readonly string[];
  /** Where in the note to scroll to, when the row is about a place rather than a file. */
  readonly start?: number;
  /** One-based, as a reader counts them. */
  readonly line?: number;
}

export function buildNoteListing(
  snapshot: IndexSnapshot,
  listing: NoteListing,
): readonly NoteListRow[] {
  switch (listing.kind) {
    case "orphans": return orphanRows(snapshot);
    case "broken": return brokenRows(snapshot);
    case "tag": return tagRows(snapshot, listing.tag);
  }
}

/** What the panel says when a list is empty. For two of these, that is good news. */
export function emptyListingMessage(listing: NoteListing): string {
  switch (listing.kind) {
    case "orphans": return "Every note is connected to another.";
    case "broken": return "Every wiki link lands somewhere.";
    case "tag": return `No note carries #${listing.tag}.`;
  }
}

export function listingTitle(listing: NoteListing): string {
  switch (listing.kind) {
    case "orphans": return "Orphan Notes";
    case "broken": return "Broken Links";
    case "tag": return `#${listing.tag}`;
  }
}

/**
 * The notes carrying a tag, each showing what else it is tagged with.
 *
 * Clicking a tag chip used to open the workspace search pre-filled with the tag — a dropdown
 * over the palette, showing an arbitrary mix of notes, tasks and text matches. A tag is a
 * collection, so it gets the same list every other collection here gets, and the other tags on
 * each note are the detail worth carrying: they are how you tell one of a tag's notes from the
 * next, and where you go from here.
 */
function tagRows(snapshot: IndexSnapshot, tag: string): readonly NoteListRow[] {
  const wanted = tag.toLocaleLowerCase();
  const rows: NoteListRow[] = [];
  for (const note of snapshot.notes) {
    if (!note.tags.some((name) => name.toLocaleLowerCase() === wanted)) continue;
    const others = note.tags.filter((name) => name.toLocaleLowerCase() !== wanted);
    rows.push({
      uri: note.uri,
      title: note.title,
      path: note.path,
      ...(others.length === 0 ? {} : { tags: others }),
    });
  }
  return rows.sort(byPath);
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
