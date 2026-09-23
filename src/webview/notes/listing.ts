import type { NoteListingWire, NoteListRowWire } from "../contracts.js";

export type NoteSort = "default" | "title" | "path";

export function parseNoteSort(value: unknown): NoteSort {
  return value === "title" || value === "path" ? value : "default";
}

export function listingKey(listing: NoteListingWire): string {
  return listing.kind === "tag" ? `tag:${listing.tag}` : listing.kind;
}

/** Search every visible field, with each word allowed to match a different field. */
export function filterNoteRows(
  rows: readonly NoteListRowWire[],
  query: string,
  tag: string,
  sort: NoteSort,
): readonly NoteListRowWire[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const visible = rows.filter((row) => {
    if (tag !== "" && !row.tags?.includes(tag)) return false;
    const text = [row.title, row.path, row.detail ?? "", ...(row.tags ?? []).map((name) => `#${name}`)]
      .join(" ").toLocaleLowerCase();
    return terms.every((term) => text.includes(term));
  });
  if (sort !== "default") {
    visible.sort((left, right) => left[sort].localeCompare(right[sort], undefined, {
      numeric: true, sensitivity: "base",
    }) || left.path.localeCompare(right.path) || (left.start ?? 0) - (right.start ?? 0));
  }
  return visible;
}
