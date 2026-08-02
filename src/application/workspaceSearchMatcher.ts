export type SearchField = "title" | "path" | "alias" | "tag" | "body" | "task";

export interface SearchCandidate {
  readonly field: SearchField;
  readonly value: string;
  /** `value` lowercased with UTF-16 length preserved, so a match index maps back into `value`. */
  readonly lower: string;
  readonly weight: number;
  readonly sourceStart: number;
  readonly sourceBacked: boolean;
}

export interface SearchMatch {
  readonly candidate: SearchCandidate;
  readonly index: number;
  readonly length: number;
  readonly score: number;
}

export interface SearchTerm {
  readonly raw: string;
  readonly lower: string;
}

export interface SearchRequest {
  readonly terms: readonly SearchTerm[];
  readonly phrase: SearchTerm | undefined;
}

export function createSearchRequest(query: string): SearchRequest {
  const trimmed = query.trim();
  if (trimmed === "") {
    return { terms: [], phrase: undefined };
  }
  const terms = trimmed.split(/\s+/u).map(createTerm);
  return {
    terms,
    phrase: terms.length > 1 ? createTerm(trimmed) : undefined,
  };
}

/**
 * Every term must match some candidate; the reported match is the highest-scoring one,
 * with ties going to a phrase match over a term match, and otherwise to candidate order.
 * This runs once per note per keystroke, so it tracks the best match as it scans instead
 * of collecting and sorting every match — same selection, no per-note allocation.
 */
export function selectSearchMatch(
  candidates: readonly SearchCandidate[],
  request: SearchRequest,
): SearchMatch | undefined {
  if (request.terms.length === 0) {
    const candidate = candidates[0];
    return candidate === undefined
      ? undefined
      : { candidate, index: 0, length: 0, score: candidate.weight };
  }

  let best = request.phrase === undefined
    ? undefined
    : bestTermMatch(candidates, request.phrase, request.terms.length, undefined);
  for (const term of request.terms) {
    const scanned = bestTermMatch(candidates, term, 1, best);
    if (scanned === undefined) {
      return undefined;
    }
    best = scanned;
  }
  return best;
}

export function lowerValueOffset(
  haystackLower: string,
  needleLower: string,
  fallback: number,
): number {
  if (needleLower === "") {
    return fallback;
  }
  const index = haystackLower.indexOf(needleLower);
  return index < 0 ? fallback : index;
}

/**
 * Lowercases without changing UTF-16 length, so an index into the result is also an index
 * into the original. The handful of characters whose lowercase form grows (İ, some
 * ligatures) are kept as written — they simply don't match case-insensitively, which is
 * what the previous regex-based matcher did for characters outside simple case folding.
 */
export function lowercasePreservingLength(value: string): string {
  const lower = value.toLowerCase();
  if (lower.length === value.length) {
    return lower;
  }
  let result = "";
  for (const character of value) {
    const lowered = character.toLowerCase();
    result += lowered.length === character.length ? lowered : character;
  }
  return result;
}

function createTerm(raw: string): SearchTerm {
  return { raw, lower: lowercasePreservingLength(raw) };
}

/*
 * The same default-locale, accent-sensitive comparison `localeCompare(value, undefined,
 * { sensitivity: "accent" })` makes — but a shared collator skips the per-call setup that
 * dominates when every candidate of every note is checked on each keystroke.
 */
const exactComparer = new Intl.Collator(undefined, { sensitivity: "accent" });

/**
 * Scans every candidate for `term`. Returns `undefined` when the term matches nothing,
 * otherwise the best of `best` and this term's matches — which may be `best` unchanged.
 */
function bestTermMatch(
  candidates: readonly SearchCandidate[],
  term: SearchTerm,
  coverage: number,
  best: SearchMatch | undefined,
): SearchMatch | undefined {
  let found = false;
  let result = best;
  for (const candidate of candidates) {
    const index = candidate.lower.indexOf(term.lower);
    if (index < 0) {
      continue;
    }
    found = true;
    const exact = exactComparer.compare(candidate.value, term.raw) === 0;
    const score = candidate.weight + coverage * 20 + (exact ? 60 : index === 0 ? 30 : 0);
    if (result === undefined || score > result.score) {
      result = { candidate, index, length: term.raw.length, score };
    }
  }
  return found ? result : undefined;
}
