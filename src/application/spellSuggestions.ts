import type { SpellDictionary } from "./spellDictionary.js";

/**
 * What the reader probably meant.
 *
 * Candidates are generated from the misspelling rather than searched for in the dictionary:
 * every word one edit away is built and then tested for membership, which is a few hundred
 * lookups against a hash set. Searching the other way — comparing the word against seventy-five
 * thousand entries — is thousands of times more work for the same answer.
 *
 * Two edits are tried only when one finds nothing, and only for words short enough that the
 * candidate set stays sane. Most real typos are a single edit; the second pass is for the ones
 * that are not, and it is bounded so a long word can never make it expensive.
 */

const LETTERS = "abcdefghijklmnopqrstuvwxyz";

/**
 * The words a typo is most likely to have been. Without a frequency list, ranking falls back
 * to length and alphabet, which puts "eh" and "meh" above "the" as corrections for "teh" —
 * technically all one edit away, and useless. A few hundred of the commonest words, ranked
 * first, fixes the corrections people actually need most often. Ordered roughly by frequency.
 */
const COMMON = new Set([
  "the", "be", "to", "of", "and", "in", "that", "have", "it", "for", "not", "on", "with", "he",
  "as", "you", "do", "at", "this", "but", "his", "by", "from", "they", "we", "say", "her", "she",
  "or", "an", "will", "my", "one", "all", "would", "there", "their", "what", "so", "up", "out",
  "if", "about", "who", "get", "which", "go", "me", "when", "make", "can", "like", "time", "no",
  "just", "him", "know", "take", "people", "into", "year", "your", "good", "some", "could",
  "them", "see", "other", "than", "then", "now", "look", "only", "come", "its", "over", "think",
  "also", "back", "after", "use", "two", "how", "our", "work", "first", "well", "way", "even",
  "new", "want", "because", "any", "these", "give", "day", "most", "us", "is", "was", "are",
  "been", "has", "had", "were", "said", "did", "made", "find", "here", "thing", "many", "before",
  "great", "through", "much", "where", "too", "very", "still", "own", "may", "such", "does",
  "note", "notes", "with", "write", "read", "file", "name", "list", "link", "page", "text",
  "need", "same", "part", "used", "line", "word", "words", "should", "more", "each", "between",
  "being", "both", "under", "while", "might", "must", "against", "during", "without", "again",
  "another", "however", "since", "until", "always", "never", "often", "already", "enough",
  "though", "around", "every", "little", "long", "right", "left", "next", "last", "small",
  "large", "different", "important", "possible", "available", "example", "number", "point",
]);


/** Past this length a two-edit search costs more than the answer is worth. */
const MAX_TWO_EDIT_LENGTH = 12;

/** More than a handful of suggestions is a menu nobody reads. */
const MAX_SUGGESTIONS = 6;

function editsOnce(word: string): Set<string> {
  const results = new Set<string>();
  for (let index = 0; index < word.length; index += 1) {
    // Deletion.
    results.add(word.slice(0, index) + word.slice(index + 1));
    // Transposition of this character and the next.
    if (index < word.length - 1) {
      results.add(
        word.slice(0, index) + word[index + 1] + word[index] + word.slice(index + 2),
      );
    }
    // Replacement.
    for (const letter of LETTERS) {
      results.add(word.slice(0, index) + letter + word.slice(index + 1));
    }
  }
  // Insertion, including at the very end.
  for (let index = 0; index <= word.length; index += 1) {
    for (const letter of LETTERS) {
      results.add(word.slice(0, index) + letter + word.slice(index));
    }
  }
  results.delete(word);
  return results;
}

/**
 * Restores the casing the reader was using, so correcting `Recieve` offers `Receive` rather
 * than `receive`. An all-caps word keeps its caps; anything else follows its first letter.
 */
function matchCase(suggestion: string, original: string): string {
  if (original.length > 1 && original === original.toUpperCase()) {
    return suggestion.toUpperCase();
  }
  if (original[0] !== undefined && original[0] === original[0].toUpperCase()) {
    return suggestion[0]?.toUpperCase() + suggestion.slice(1);
  }
  return suggestion;
}

export function spellSuggestions(
  word: string,
  dictionary: SpellDictionary,
  limit = MAX_SUGGESTIONS,
): readonly string[] {
  const normalized = word.toLowerCase();
  if (normalized.length === 0) return [];

  const oneEdit = editsOnce(normalized);
  const found: string[] = [];
  for (const candidate of oneEdit) {
    if (dictionary.words.has(candidate)) found.push(candidate);
  }

  if (found.length === 0 && normalized.length <= MAX_TWO_EDIT_LENGTH) {
    const seen = new Set<string>();
    for (const first of oneEdit) {
      for (const second of editsOnce(first)) {
        if (seen.has(second) || !dictionary.words.has(second)) continue;
        seen.add(second);
        found.push(second);
        if (found.length >= limit * 4) break;
      }
      if (found.length >= limit * 4) break;
    }
  }

  /*
   * Edit distance alone leaves far too many ties, so they are broken by what a typo usually
   * looks like: a common word first, then one the same length as what was typed (a
   * transposition or a slip of one key, rather than a dropped or doubled letter), then one
   * starting with the same letter, and only then the alphabet.
   */
  const rank = (candidate: string): number =>
    (COMMON.has(candidate) ? 0 : 8) +
    (candidate.length === normalized.length ? 0 : 2) +
    (candidate[0] === normalized[0] ? 0 : 1);
  found.sort((left, right) =>
    rank(left) - rank(right) ||
    left.length - right.length ||
    left.localeCompare(right));
  return found.slice(0, limit).map((suggestion) => matchCase(suggestion, word));
}
