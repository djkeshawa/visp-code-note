export type SearchField = "title" | "path" | "alias" | "tag" | "body" | "task";

export interface SearchCandidate {
  readonly field: SearchField;
  readonly value: string;
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

interface SearchPattern {
  readonly raw: string;
  readonly expression: RegExp;
}

export interface SearchRequest {
  readonly terms: readonly SearchPattern[];
  readonly phrase: SearchPattern | undefined;
}

export function createSearchRequest(query: string): SearchRequest {
  const trimmed = query.trim();
  if (trimmed === "") {
    return { terms: [], phrase: undefined };
  }
  const terms = trimmed.split(/\s+/u).map(createPattern);
  return {
    terms,
    phrase: terms.length > 1 ? createPattern(trimmed) : undefined,
  };
}

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

  const termMatchGroups = request.terms.map((term) => matchesForPattern(candidates, term, 1));
  if (termMatchGroups.some((matches) => matches.length === 0)) {
    return undefined;
  }

  const phraseMatches = request.phrase === undefined
    ? []
    : matchesForPattern(candidates, request.phrase, request.terms.length);
  return [...phraseMatches, ...termMatchGroups.flat()]
    .sort((left, right) => right.score - left.score)[0];
}

export function valueOffset(content: string, value: string, fallback: number): number {
  if (value === "") {
    return fallback;
  }
  return createPattern(value).expression.exec(content)?.index ?? fallback;
}

function matchesForPattern(
  candidates: readonly SearchCandidate[],
  pattern: SearchPattern,
  coverage: number,
): readonly SearchMatch[] {
  const matches: SearchMatch[] = [];
  for (const candidate of candidates) {
    const index = findIndex(candidate.value, pattern);
    if (index < 0) {
      continue;
    }
    const exact = candidate.value.localeCompare(pattern.raw, undefined, { sensitivity: "accent" }) === 0;
    matches.push({
      candidate,
      index,
      length: pattern.raw.length,
      score: candidate.weight + coverage * 20 + (exact ? 60 : index === 0 ? 30 : 0),
    });
  }
  return matches;
}

function createPattern(raw: string): SearchPattern {
  return {
    raw,
    expression: new RegExp(escapeRegExp(raw), "iu"),
  };
}

function findIndex(value: string, pattern: SearchPattern): number {
  return pattern.expression.exec(value)?.index ?? -1;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
