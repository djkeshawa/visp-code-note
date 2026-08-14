import type { IndexSnapshot, NoteRecord } from "../domain/models";

type TaskRecord = IndexSnapshot["tasks"][number];

/**
 * The part of a query that says *where to look* rather than *what to find*.
 *
 * In a 2,000-note vault "budget" is not a query: it is most of the vault. `path:meetings`,
 * `tag:finance`, `is:open` and `modified:7d` are how a reader says which part of it they
 * mean, and they are kept apart from the words because they are answered differently —
 * a word goes to the text index, a facet is a predicate on the record.
 *
 * Every list is AND: each entry has to hold. Repeating a facet therefore narrows, exactly
 * as repeating a word does. OR would make a repeated facet the only token in this grammar
 * that widens, and nothing in a query says which rule a given token is under.
 */
export interface SearchFilters {
  /** Case-insensitive substrings of the note path. */
  readonly paths: readonly string[];
  /** Tag names without the `#`; a parent matches its nested children. */
  readonly tags: readonly string[];
  readonly kinds: readonly ("note" | "task")[];
  readonly states: readonly ("open" | "done")[];
  /** Absolute moments, resolved when the query was read; `modifiedAt` must be at or after each. */
  readonly modifiedSince: readonly number[];
}

export const NO_SEARCH_FILTERS: SearchFilters = {
  paths: [],
  tags: [],
  kinds: [],
  states: [],
  modifiedSince: [],
};

export type SearchFacet =
  | { readonly facet: "path"; readonly value: string }
  | { readonly facet: "tag"; readonly value: string }
  | { readonly facet: "kind"; readonly value: "note" | "task" }
  | { readonly facet: "state"; readonly value: "open" | "done" }
  | { readonly facet: "modified"; readonly since: number }
  /** A facet whose value has not been typed yet — recognised, and constraining nothing. */
  | { readonly facet: "unfinished" };

const FACET_NAMES: readonly string[] = ["path", "tag", "is", "modified"];

/**
 * Splits a bare token into a facet name and its value at the first colon, or reports that
 * there is no facet here.
 *
 * The name must be letters, so `ratio 3:1` is prose and `http://example.com` is a link —
 * neither is a filter. Everything after the first colon is the value, colons included:
 * a path may hold one, and a reader who typed one meant it.
 */
export function splitFacetToken(token: string): { name: string; value: string } | undefined {
  const colon = token.indexOf(":");
  if (colon <= 0) {
    return undefined;
  }
  const name = token.slice(0, colon);
  return /^[A-Za-z]+$/.test(name) ? { name, value: token.slice(colon + 1) } : undefined;
}

/**
 * Reads one `name:value` pair, or returns `undefined` when it is not a facet this search
 * understands — an unknown name, or a value the facet cannot make sense of.
 *
 * `undefined` matters as much as the facets do. The caller puts the token back into the
 * words to search for, so `author:kim` and `modified:banana` find nothing and say so, rather
 * than being dropped and answering with everything. A dropped filter is the silent wrong
 * answer: the reader asked a narrower question than the list they are reading.
 */
export function readSearchFacet(name: string, value: string, now: number): SearchFacet | undefined {
  const facetName = name.toLowerCase();
  if (!FACET_NAMES.includes(facetName)) {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed === "") {
    return { facet: "unfinished" };
  }
  const lower = trimmed.toLowerCase();
  switch (facetName) {
    case "path":
      return { facet: "path", value: lower };
    case "tag":
      return { facet: "tag", value: lower.startsWith("#") ? lower.slice(1) : lower };
    case "is":
      return readIsFacet(lower);
    default:
      return readModifiedFacet(lower, now);
  }
}

export function searchFiltersFrom(facets: readonly SearchFacet[]): SearchFilters {
  const paths: string[] = [];
  const tags: string[] = [];
  const kinds: ("note" | "task")[] = [];
  const states: ("open" | "done")[] = [];
  const modifiedSince: number[] = [];
  for (const facet of facets) {
    switch (facet.facet) {
      case "path": paths.push(facet.value); break;
      case "tag": tags.push(facet.value); break;
      case "kind": kinds.push(facet.value); break;
      case "state": states.push(facet.value); break;
      case "modified": modifiedSince.push(facet.since); break;
      case "unfinished": break;
    }
  }
  return { paths, tags, kinds, states, modifiedSince };
}

export function hasSearchFilters(filters: SearchFilters): boolean {
  return filters.paths.length > 0 || filters.tags.length > 0 || filters.kinds.length > 0 ||
    filters.states.length > 0 || filters.modifiedSince.length > 0;
}

/** Whether a task can be judged without its note, so the caller only builds the map it needs. */
export function taskFiltersNeedNote(filters: SearchFilters): boolean {
  return filters.tags.length > 0 || filters.modifiedSince.length > 0;
}

export function noteMatchesFilters(filters: SearchFilters, note: NoteRecord): boolean {
  // A note is neither open nor done, so a query asking about either is not asking about notes.
  return filters.states.length === 0 &&
    filters.kinds.every((kind) => kind === "note") &&
    filters.paths.every((value) => note.path.toLowerCase().includes(value)) &&
    filters.tags.every((value) => tagsMatch(note.tags, value)) &&
    filters.modifiedSince.every((since) => note.modifiedAt >= since);
}

/**
 * `note` is the record the task was written in, when the caller has it. A task inherits its
 * note's tags and its note's modification time: the reader tagged the note, and a task is
 * part of that note's subject, not a separate document with a date of its own.
 */
export function taskMatchesFilters(
  filters: SearchFilters,
  task: TaskRecord,
  note: NoteRecord | undefined,
): boolean {
  return filters.kinds.every((kind) => kind === "task") &&
    filters.states.every((state) => state === (task.completed ? "done" : "open")) &&
    filters.paths.every((value) => task.notePath.toLowerCase().includes(value)) &&
    filters.tags.every((value) =>
      tagsMatch(task.tags, value) || (note !== undefined && tagsMatch(note.tags, value))) &&
    filters.modifiedSince.every((since) => note !== undefined && note.modifiedAt >= since);
}

/** `tag:project` finds `#project/atlas`: the parent is how the reader named the family. */
function tagsMatch(tags: readonly string[], value: string): boolean {
  return tags.some((tag) => {
    const lower = tag.toLowerCase();
    return lower === value || lower.startsWith(`${value}/`);
  });
}

function readIsFacet(value: string): SearchFacet | undefined {
  switch (value) {
    case "note":
    case "task":
      return { facet: "kind", value };
    case "open":
    case "done":
      return { facet: "state", value };
    default:
      return undefined;
  }
}

const RELATIVE_SPAN = /^(\d{1,5})([hdw])$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const SPAN_MILLISECONDS: Readonly<Record<string, number>> = {
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
};

/**
 * `7d`, `12h`, `2w`, `today`, or a date. A span counts back from now; a date counts from
 * local midnight, because a reader writing `modified:2026-08-01` means the whole of that day
 * as their clock shows it, not as UTC does.
 */
function readModifiedFacet(value: string, now: number): SearchFacet | undefined {
  if (value === "today") {
    const midnight = new Date(now);
    midnight.setHours(0, 0, 0, 0);
    return { facet: "modified", since: midnight.getTime() };
  }
  const span = RELATIVE_SPAN.exec(value);
  if (span !== null) {
    const amount = Number(span[1]);
    return { facet: "modified", since: now - amount * (SPAN_MILLISECONDS[span[2] as string] ?? 0) };
  }
  const date = ISO_DATE.exec(value);
  if (date === null) {
    return undefined;
  }
  const year = Number(date[1]);
  const month = Number(date[2]);
  const day = Number(date[3]);
  const parsed = new Date(year, month - 1, day);
  // Rejects the days that do not exist: `2026-02-31` would otherwise roll into March.
  return parsed.getFullYear() === year && parsed.getMonth() === month - 1 &&
      parsed.getDate() === day
    ? { facet: "modified", since: parsed.getTime() }
    : undefined;
}
