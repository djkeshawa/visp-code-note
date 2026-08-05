import assert = require("node:assert/strict");
import { test } from "node:test";
import { createSpellDictionary, parseDictionary } from "../../src/application/spellDictionary";
import { spellSuggestions } from "../../src/application/spellSuggestions";
import { misspelledWords } from "../../src/application/spellCheckText";

/**
 * What a spell checker in a notes app has to do, stated the way a reader would state it.
 *
 * The hard requirement is not catching misspellings — any word list does that — it is leaving
 * alone the large amount of a note that is not English prose.
 */

const dictionary = createSpellDictionary(
  ["the", "note", "title", "receive", "definitely", "workspace", "america", "colour", "separate", "their"],
  ["visp"],
);

const words = (source: string, skip: readonly { start: number; end: number }[] = []): string[] =>
  misspelledWords(source, dictionary, skip).map((found) => found.word);

test("a word in the dictionary is not flagged, whatever its casing", () => {
  assert.deepEqual(words("The note. AMERICA. Receive."), []);
});

test("a word not in the dictionary is flagged", () => {
  assert.deepEqual(words("recieve the note"), ["recieve"]);
});

test("a word the reader added themselves is accepted", () => {
  assert.deepEqual(words("visp is a note"), []);
});

test("a possessive of a known word is accepted without listing it", () => {
  assert.deepEqual(words("the note's title"), []);
});

/*
 * The part that actually decides whether this is usable. A notes app is full of text that is
 * not English, and underlining it would make the feature worse than nothing.
 */
test("short tokens and identifier fragments are never flagged", () => {
  assert.deepEqual(words("a an ok id"), [], "one and two letter tokens are not words to argue with");
  assert.deepEqual(words("utf8 sha256 snake_case x2"), [], "tokens touching digits or underscores");
});

test("anything the caller marks as not-prose is skipped", () => {
  const source = "the zzqq note";
  assert.deepEqual(words(source), ["zzqq"], "flagged when nothing is protected");
  assert.deepEqual(
    words(source, [{ start: 4, end: 8 }]),
    [],
    "and silent when the caller says that span is a link, a tag or code",
  );
});

test("offsets point at the word, so a correction can replace exactly it", () => {
  const found = misspelledWords("the recieve note", dictionary);
  assert.equal(found.length, 1);
  assert.equal("the recieve note".slice(found[0]!.start, found[0]!.end), "recieve");
});

test("suggestions offer the word that was meant", () => {
  assert.equal(spellSuggestions("recieve", dictionary).includes("receive"), true);
  assert.equal(spellSuggestions("seperate", dictionary).includes("separate"), true);
  assert.equal(spellSuggestions("thier", dictionary).includes("their"), true);
});

test("suggestions keep the casing the reader was using", () => {
  assert.equal(spellSuggestions("Recieve", dictionary)[0], "Receive");
  assert.equal(spellSuggestions("RECIEVE", dictionary)[0], "RECEIVE");
});

test("a word nothing resembles offers nothing rather than nonsense", () => {
  assert.deepEqual(spellSuggestions("zzzqqqxxx", dictionary), []);
});

test("the dictionary file format skips blanks and comments", () => {
  assert.deepEqual(parseDictionary("# provenance\n\nAlpha\n beta \n"), ["alpha", "beta"]);
});

/*
 * Ranking is most of what makes a corrector useful. Every candidate here is one edit from the
 * typo, so distance cannot choose between them: "eh", "meh" and "the" are equally close to
 * "teh", and only one of them is ever the answer.
 */
test("the commonest word wins when several are equally close", () => {
  const wide = createSpellDictionary(["the", "eh", "meh", "tea", "ted", "tee", "then"]);
  assert.equal(spellSuggestions("teh", wide)[0], "the");

  const andLike = createSpellDictionary(["and", "ad", "an", "end", "ana"]);
  assert.equal(spellSuggestions("adn", andLike)[0], "and");
});
