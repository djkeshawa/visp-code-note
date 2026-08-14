import type { IndexSnapshot, NoteRecord } from "../domain/models";

export interface TagChoice {
  readonly tag: string;
  readonly count: number;
}

/*
 * One tag vocabulary per index commit, for everything that offers tags.
 *
 * The quick pick asks for this once, when the reader opens it. The note editor's `#` completion
 * needs it on every publish, which is why the memo is not optional: counting the tags of 2,000
 * notes takes 6.4ms on this machine, and a body edit is budgeted at 0.018ms. Derived per call it
 * would have put three hundred times the cost of the edit back into the typing path that was
 * just cleared.
 *
 * The index publishes a fresh frozen array on every commit and never mutates one, so the array
 * is itself the statement that this list is still true, and a WeakMap lets it go with the
 * snapshot rather than pinning the last vault in memory.
 */
const vocabularies = new WeakMap<readonly NoteRecord[], readonly TagChoice[]>();

/**
 * Every tag in the workspace with how many notes carry it, most used first. Names are
 * de-duplicated case-insensitively, keeping the first spelling seen — the same rule the
 * parser applies when merging a note's frontmatter and inline tags.
 */
export function workspaceTags(snapshot: IndexSnapshot): readonly TagChoice[] {
  const remembered = vocabularies.get(snapshot.notes);
  if (remembered !== undefined) return remembered;

  const counts = new Map<string, { tag: string; count: number }>();
  for (const note of snapshot.notes) {
    for (const tag of note.tags) {
      const key = tag.toLocaleLowerCase();
      const current = counts.get(key);
      counts.set(key, { tag: current?.tag ?? tag, count: (current?.count ?? 0) + 1 });
    }
  }
  const vocabulary = Object.freeze([...counts.values()].sort(
    (left, right) => right.count - left.count ||
      left.tag.localeCompare(right.tag, undefined, { sensitivity: "base" }),
  ));
  vocabularies.set(snapshot.notes, vocabulary);
  return vocabulary;
}

/**
 * Just the names, most used first, for the note editor's `#` completion.
 *
 * Usage order is the ranking a tie falls back on: when two tags match a query equally well, the
 * one the workspace already leans on is the one the writer most likely means, and offering it
 * first is what keeps `#project` from quietly becoming `#project` and `#projects`.
 */
export function workspaceTagNames(snapshot: IndexSnapshot): readonly string[] {
  return workspaceTags(snapshot).map((choice) => choice.tag);
}
