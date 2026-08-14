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

/**
 * Splits a query into the terms a result has to match, all of them.
 *
 * Quoted words are one term rather than several. Quoting a phrase is the one search
 * convention every reader arrives already knowing, and until it was read as one the quote
 * characters became part of what had to be matched — so a query that had just been narrowed
 * by hand returned nothing at all, and the reader concluded the note was gone.
 *
 * A quote the reader has not closed yet is read as closing at the end of the query, so the
 * list narrows while the phrase is being typed instead of only once it is finished. Curly
 * quotes count as quotes: a Mac, a phone and every word processor produce them from the same
 * keystroke, and this code base already treats the curly apostrophe as real. The apostrophe
 * itself is not a quote here — it is a letter in the middle of ordinary words.
 */
export function createSearchRequest(query: string): SearchRequest {
  const terms: SearchTerm[] = [];
  for (const [, quoted, bare] of query.trim().matchAll(QUERY_TOKEN)) {
    const text = quoted ?? bare;
    if (text !== undefined && text !== "") {
      terms.push(createTerm(text));
    }
  }
  return {
    terms,
    phrase: terms.length > 1 ? createTerm(terms.map((term) => term.raw).join(" ")) : undefined,
  };
}

/** A quoted run, whether or not it was closed, or a run of anything that is not whitespace. */
const QUERY_TOKEN = /["“”]([^"“”]*)["“”]?|([^\s"“”]+)/gu;

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
