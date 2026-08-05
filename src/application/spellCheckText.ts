import { createRangeIndex } from "../markdown/lines.js";
import type { OffsetRange } from "../domain/models.js";
import type { SpellDictionary } from "./spellDictionary.js";

/**
 * Which words in a stretch of note text are misspelled.
 *
 * The hard part of spell-checking a note is not the dictionary, it is knowing what is prose.
 * A note is full of text that is not English and must never be underlined: the target of a
 * wiki link is a file name, a tag is an address, a fenced block is source code, and
 * frontmatter is configuration. Each of those is already found by the parser, so the caller
 * passes their ranges in and this only has to avoid them — rather than this file growing its
 * own second, worse idea of what Markdown is.
 *
 * Nothing here touches the editor, so what counts as a word and what is left alone is
 * decided in one testable place.
 */

/**
 * A word is letters, optionally carrying an apostrophe, as in `doesn't` or `note's`. Digits
 * end a word rather than joining it, so `utf8` and `v2` are two tokens and neither is
 * checked — see `isCheckable`.
 */
const WORD = /[\p{L}][\p{L}'’]*/gu;

export interface Misspelling {
  readonly start: number;
  readonly end: number;
  readonly word: string;
}

/**
 * Words too short to be worth an opinion, and the shapes that are never prose. A single or
 * two-letter token is almost always an abbreviation, an initial or a unit, and flagging those
 * produces far more noise than it catches.
 */
const MIN_LENGTH = 3;

function isCheckable(word: string, source: string, start: number, end: number): boolean {
  if (word.length < MIN_LENGTH) return false;
  /*
   * A token touching a digit or an underscore belongs to an identifier rather than a
   * sentence — `utf8`, `sha256`, `snake_case`. The word itself carries no digit, because the
   * pattern stops at one, so the character either side is what gives it away.
   */
  const before = source[start - 1];
  const after = source[end];
  if (before !== undefined && /[\p{N}_]/u.test(before)) return false;
  if (after !== undefined && /[\p{N}_]/u.test(after)) return false;
  return true;
}

export function misspelledWords(
  source: string,
  dictionary: SpellDictionary,
  skipRanges: readonly OffsetRange[] = [],
  offset = 0,
): readonly Misspelling[] {
  const skipped = createRangeIndex(skipRanges);
  const found: Misspelling[] = [];
  WORD.lastIndex = 0;
  for (const match of source.matchAll(WORD)) {
    if (match.index === undefined) continue;
    const start = match.index;
    const end = start + match[0].length;
    if (!isCheckable(match[0], source, start, end)) continue;
    // Ranges are given in the same coordinates the caller asked about.
    if (skipped.covers(offset + start, offset + end)) continue;
    if (dictionary.has(match[0])) continue;
    found.push({ start: offset + start, end: offset + end, word: match[0] });
  }
  return found;
}
