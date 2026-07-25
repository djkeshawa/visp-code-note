import { decodeWikiTarget, encodeWikiTarget } from "../domain/normalization";
import type { NoteSuggestion } from "../domain/protocol";

export type WikiSuggestionKind = "note" | "heading" | "block";

export interface WikiSuggestionCandidate {
  readonly kind: WikiSuggestionKind;
  readonly label: string;
  readonly target: string;
  readonly path: string;
  readonly filterText: string;
}

export interface WikiSuggestionBatch {
  readonly items: readonly WikiSuggestionCandidate[];
  readonly isIncomplete: boolean;
}

export function rankWikiSuggestions(
  notes: readonly NoteSuggestion[],
  query: string,
): readonly WikiSuggestionCandidate[] {
  const reference = parseReferenceQuery(query);
  if (reference === undefined) {
    return rankNotes(notes, query);
  }
  const note = findReferenceNote(notes, reference.noteQuery);
  if (note === undefined) {
    return [];
  }
  const values = reference.kind === "heading" ? note.headings : note.blockIds;
  return rankValues(values, reference.valueQuery).map((value) => {
    const suffix = reference.kind === "heading"
      ? `#${encodeWikiTarget(value)}`
      : `${reference.headingPrefix}^${encodeWikiTarget(value)}`;
    const target = `${note.referenceTarget}${suffix}`;
    const identifiers = unique([
      note.referenceTarget,
      note.target,
      note.label,
      note.path,
      ...note.aliases,
    ]).filter((identifier) => identifier.length > 0);
    return {
      kind: reference.kind,
      label: reference.kind === "heading" ? value : `^${value}`,
      target,
      path: note.path,
      filterText: [
        target,
        ...identifiers,
        ...identifiers.map((identifier) => `${identifier}${suffix}`),
        value,
      ].join(" "),
    };
  });
}

export function limitWikiSuggestions(
  candidates: readonly WikiSuggestionCandidate[],
  limit: number,
): WikiSuggestionBatch {
  const safeLimit = Math.max(0, Math.floor(limit));
  return {
    items: candidates.slice(0, safeLimit),
    isIncomplete: candidates.length > safeLimit,
  };
}

interface ReferenceQuery {
  readonly kind: "heading" | "block";
  readonly noteQuery: string;
  readonly valueQuery: string;
  readonly headingPrefix: string;
}

function parseReferenceQuery(query: string): ReferenceQuery | undefined {
  const headingAt = query.indexOf("#");
  const blockAt = query.lastIndexOf("^");
  if (blockAt >= 0) {
    const noteEnd = headingAt >= 0 && headingAt < blockAt ? headingAt : blockAt;
    return {
      kind: "block",
      noteQuery: query.slice(0, noteEnd),
      valueQuery: query.slice(blockAt + 1),
      headingPrefix: headingAt >= 0 && headingAt < blockAt ? query.slice(headingAt, blockAt) : "",
    };
  }
  return headingAt < 0 ? undefined : {
    kind: "heading",
    noteQuery: query.slice(0, headingAt),
    valueQuery: query.slice(headingAt + 1),
    headingPrefix: "",
  };
}

function rankNotes(
  notes: readonly NoteSuggestion[],
  query: string,
): readonly WikiSuggestionCandidate[] {
  const normalized = normalize(query);
  return notes
    .map((note) => ({ note, score: noteScore(note, normalized) }))
    .filter((candidate) => Number.isFinite(candidate.score))
    .sort((left, right) => left.score - right.score || left.note.label.localeCompare(right.note.label))
    .map(({ note }) => ({
      kind: "note",
      label: note.label,
      target: note.target,
      path: note.path,
      filterText: [note.label, note.target, note.path, ...note.aliases].join(" "),
    }));
}

function findReferenceNote(
  notes: readonly NoteSuggestion[],
  noteQuery: string,
): NoteSuggestion | undefined {
  const normalized = normalize(noteQuery);
  if (normalized === "") {
    return notes.find((note) => note.referenceTarget === "");
  }
  return notes.find((note) => [note.target, note.referenceTarget, note.label, ...note.aliases]
    .some((value) => normalize(value) === normalized));
}

function rankValues(values: readonly string[], query: string): readonly string[] {
  const normalized = normalize(query);
  return values
    .map((value) => ({ value, score: fuzzyScore(normalize(value), normalized) }))
    .filter((candidate) => Number.isFinite(candidate.score))
    .sort((left, right) => left.score - right.score || left.value.localeCompare(right.value))
    .map((candidate) => candidate.value);
}

function noteScore(note: NoteSuggestion, query: string): number {
  if (query === "") {
    return 0;
  }
  return Math.min(
    fuzzyScore(normalize(note.label), query),
    fuzzyScore(normalize(note.target), query) + 1,
    fuzzyScore(normalize(note.path), query) + 2,
    ...note.aliases.map((alias) => fuzzyScore(normalize(alias), query) + 0.5),
  );
}

function fuzzyScore(candidate: string, query: string): number {
  if (candidate.startsWith(query)) {
    return candidate.length - query.length;
  }
  let position = -1;
  let gaps = 0;
  for (const character of query) {
    const next = candidate.indexOf(character, position + 1);
    if (next === -1) {
      return Number.POSITIVE_INFINITY;
    }
    gaps += next - position - 1;
    position = next;
  }
  return 100 + gaps + candidate.length * 0.01;
}

function normalize(value: string): string {
  return decodeWikiTarget(value).trim().replace(/\.md$/i, "").toLocaleLowerCase();
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}
