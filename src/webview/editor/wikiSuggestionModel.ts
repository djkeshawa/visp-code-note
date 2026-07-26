import type { NoteSuggestionWire } from "../contracts.js";

export interface WikiQuery {
  readonly start: number;
  readonly end: number;
  readonly query: string;
}

export interface WikiSuggestionMatch {
  readonly kind: "note" | "heading" | "block";
  readonly label: string;
  readonly target: string;
  readonly path: string;
}

export function findWikiQuery(
  value: string,
  selectionStart: number,
  selectionEnd: number,
): WikiQuery | undefined {
  if (selectionStart !== selectionEnd) {
    return undefined;
  }
  const beforeCaret = value.slice(0, selectionStart);
  const opener = beforeCaret.lastIndexOf("[[");
  if (opener === -1 || isEscapedAt(value, opener)) {
    return undefined;
  }
  const query = beforeCaret.slice(opener + 2);
  if (/[\r\n[\]|]/.test(query)) {
    return undefined;
  }
  return { start: opener + 2, end: selectionStart, query };
}

function isEscapedAt(value: string, position: number): boolean {
  let backslashes = 0;
  for (let index = position - 1; index >= 0 && value[index] === "\\"; index -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

export function rankSuggestions(
  suggestions: readonly NoteSuggestionWire[],
  query: string,
): readonly WikiSuggestionMatch[] {
  const reference = parseReferenceQuery(query);
  if (reference !== undefined) {
    const note = findReferenceNote(suggestions, reference.noteQuery);
    if (note === undefined) {
      return [];
    }
    const values = reference.kind === "heading" ? note.headings : note.blockIds;
    return rankValues(values, reference.valueQuery).map((value) => ({
      kind: reference.kind,
      label: reference.kind === "heading" ? value : `^${value}`,
      target: reference.kind === "heading"
        ? `${note.referenceTarget}#${encodeReference(value)}`
        : `${note.referenceTarget}${reference.headingPrefix}^${encodeReference(value)}`,
      path: note.path,
    }));
  }
  const normalizedQuery = normalize(query);
  return suggestions
    .map((suggestion) => ({ suggestion, score: suggestionScore(suggestion, normalizedQuery) }))
    .filter((candidate) => Number.isFinite(candidate.score))
    .sort((left, right) => left.score - right.score || left.suggestion.label.localeCompare(right.suggestion.label))
    .map(({ suggestion }) => ({
      kind: "note" as const,
      label: suggestion.label,
      target: suggestion.target,
      path: suggestion.path,
    }));
}

function suggestionScore(suggestion: NoteSuggestionWire, query: string): number {
  if (query.length === 0) {
    return 0;
  }
  return Math.min(
    fuzzyScore(normalize(suggestion.label), query),
    fuzzyScore(normalize(suggestion.target), query) + 1,
    fuzzyScore(normalize(suggestion.path), query) + 2,
    ...suggestion.aliases.map((alias) => fuzzyScore(normalize(alias), query) + 0.5),
  );
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

function findReferenceNote(
  notes: readonly NoteSuggestionWire[],
  noteQuery: string,
): NoteSuggestionWire | undefined {
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

function encodeReference(value: string): string {
  return encodeURIComponent(value).replace(/%20/g, " ");
}

function normalize(value: string): string {
  try {
    return decodeURIComponent(value).trim().replace(/\.md$/i, "").toLocaleLowerCase();
  } catch {
    return value.trim().replace(/\.md$/i, "").toLocaleLowerCase();
  }
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
