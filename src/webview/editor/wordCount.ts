/**
 * How the editor's footer says how long the note is.
 *
 * Every other view ends in a footer stating what it is holding — "12 of 40 tasks", "9 shown" —
 * and the surface holding the whole document was the one that would not say. The wording
 * follows those: the number that is being looked at, then what it is a number of.
 */
export interface WordCounts {
  readonly total: number;
  /** Present only while something is selected. */
  readonly selected?: number;
}

export function wordCountLabel(counts: WordCounts): string {
  const noun = counts.total === 1 ? "word" : "words";
  return counts.selected === undefined
    ? `${counts.total} ${noun}`
    : `${counts.selected} of ${counts.total} ${noun} selected`;
}
