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

/**
 * Endings a word list does not carry but English derives freely.
 *
 * The bundled list has no apostrophes at all, so without these every contraction in ordinary
 * prose is a misspelling — thirteen of sixteen in a normal sentence, which is enough noise to
 * make a reader switch the whole feature off. Stripping the ending and checking the stem is
 * both smaller and more accurate than listing every contracted form.
 */
const CONTRACTED = /['’](?:re|ve|ll|d|m|s|t)$/i;

/**
 * The word a contraction was built from, of which there may be two.
 *
 * `not` elides differently depending on what it follows: `do not` becomes `do` + `n't`, but
 * `can not` becomes `can` + `'t` — the `n` belongs to the verb in one and to the negation in
 * the other. Both readings are offered and either being a word is enough, which is far simpler
 * than deciding which verbs keep their `n`.
 */
function contractionStems(word: string): readonly string[] {
  const stems: string[] = [];
  const withoutEnding = word.replace(CONTRACTED, "");
  if (withoutEnding !== word && withoutEnding.length > 0) stems.push(withoutEnding);
  if (/n['’]t$/i.test(word)) {
    const withoutNot = word.slice(0, -3);
    if (withoutNot.length > 0) stems.push(withoutNot);
  }
  return stems;
}

/**
 * The contractions whose stem is not itself a word: `won't` is not `wo`, `o'clock` is not
 * `o`. A handful of irregulars is the whole exception list.
 */
const IRREGULAR = new Set([
  "won't", "shan't", "ain't", "y'all", "o'clock", "ma'am", "'tis", "'twas",
]);

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
      // A typed apostrophe and a typographic one are the same apostrophe.
      const straightened = normalized.replace(/’/g, "'");
      if (IRREGULAR.has(straightened)) return true;
      /*
       * `the note's title`, `they're`, `don't` — all built from a word the list does carry.
       * Stripping the ending and checking the stem covers every regular case at no cost.
       */
      return contractionStems(straightened).some(known);
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
