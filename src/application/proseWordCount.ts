import { fencedLines } from "../markdown/outline.js";
import { parseFrontmatter } from "../markdown/frontmatter.js";
import { scanLines } from "../markdown/lines.js";
import { removeTagTokens } from "../markdown/tags.js";

/**
 * How many words of prose a note holds.
 *
 * A notes file is mostly not prose, and a count of the source is confidently wrong: the
 * frontmatter, a fenced sample, a URL and the markers a task carries would all inflate it, and
 * the reader checking a draft against a limit has no way to see that they had. This is the same
 * idea the spell checker works from — the parts of a line that are not English are already
 * found elsewhere, so this only has to leave them out.
 *
 * Counted from lines and patterns rather than from a full parse: it runs whenever the typing
 * pauses, over the whole note, and it must cost one pass over the text and nothing more.
 */

/**
 * A word is letters or digits, joined by an apostrophe or a hyphen — `doesn't` and
 * `state-of-the-art` are each one word, as they are to anyone counting by hand.
 */
const WORD = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;

/**
 * The parts of a line that are not read as words. A link's destination goes and its label
 * stays; a wiki link's target goes when an alias is written in front of it, because the alias
 * is what the reader sees.
 */
const NOT_PROSE: readonly RegExp[] = [
  /<!--[\s\S]*?-->/g,
  /`[^`\r\n]*`/g,
  /@(?:due|remind|priority)\([^)]*\)/gi,
  /\]\([^)\r\n]*\)/g,
  /\[\[[^\][\r\n]*\|/g,
  // Mirrors the checkbox `matchTaskLine` reads: the `x` in `[x]` is a state, not a word.
  /^\s*(?:[-+*]|\d+[.)])\s+\[[ xX]\]/,
];

export function proseWordCount(source: string): number {
  const lines = scanLines(source);
  const texts = lines.map((line) => line.text);
  const frontmatterLines = parseFrontmatter(lines).lineCount;
  const fenced = fencedLines(texts);

  let words = 0;
  for (const [index, text] of texts.entries()) {
    if (index < frontmatterLines || fenced.has(index)) continue;
    words += wordsInLine(text);
  }
  return words;
}

function wordsInLine(text: string): number {
  let prose = text;
  for (const pattern of NOT_PROSE) prose = prose.replace(pattern, " ");
  // The tag pattern is the parser's own, so a `#` in prose and a `#tag` are told apart once.
  prose = removeTagTokens(prose);
  return prose.match(WORD)?.length ?? 0;
}
