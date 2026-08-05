/**
 * Which words a note is allowed to contain.
 *
 * The dictionary is a flat list of lowercase words, so a single entry covers every casing a
 * reader might write — `america`, `America` and `AMERICA` are one word here. That is the right
 * trade for prose: a spell checker that argued about capitalisation would be wrong far more
 * often than it was right, because a note is full of sentence starts, headings and acronyms.
 *
 * Nothing in this file touches the editor or the file system, so the whole of the decision —
 * "is this a word, and if not what did they mean" — can be tested directly.
 */

/** Suffixes a word list does not carry but English derives freely. */
const POSSESSIVE = /['’]s$/;

export interface SpellDictionary {
  /** Whether a word as written should be left alone. */
  readonly has: (word: string) => boolean;
  /** Every known word, for generating suggestions. */
  readonly words: ReadonlySet<string>;
}

/**
 * Builds a dictionary from the bundled list and whatever the reader has added themselves.
 *
 * Personal words are held apart rather than merged so the caller can persist them on their
 * own, and so a word the reader added can be removed again without rebuilding the list.
 */
export function createSpellDictionary(
  listed: Iterable<string>,
  personal: Iterable<string> = [],
): SpellDictionary {
  const words = new Set<string>();
  for (const word of listed) {
    const normalized = word.trim().toLowerCase();
    if (normalized.length > 0) words.add(normalized);
  }
  const personalWords = new Set<string>();
  for (const word of personal) {
    const normalized = word.trim().toLowerCase();
    if (normalized.length > 0) personalWords.add(normalized);
  }

  const known = (candidate: string): boolean =>
    words.has(candidate) || personalWords.has(candidate);

  return {
    words,
    has: (word: string): boolean => {
      const normalized = word.toLowerCase();
      if (normalized.length === 0) return true;
      if (known(normalized)) return true;
      /*
       * `the note's title` is the possessive of a word the list does carry. Stripping it is
       * cheaper and far more accurate than listing every possessive form separately, which is
       * why the bundled list has none.
       */
      const withoutPossessive = normalized.replace(POSSESSIVE, "");
      return withoutPossessive !== normalized && known(withoutPossessive);
    },
  };
}

/**
 * Reads the bundled dictionary file.
 *
 * Blank lines are skipped and `#` opens a comment, so the file can carry its own provenance
 * without those lines being read as words.
 */
export function parseDictionary(contents: string): readonly string[] {
  const words: string[] = [];
  for (const line of contents.split("\n")) {
    const word = line.trim();
    if (word.length === 0 || word.startsWith("#")) continue;
    words.push(word.toLowerCase());
  }
  return words;
}
