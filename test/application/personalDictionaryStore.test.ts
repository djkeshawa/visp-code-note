import assert = require("node:assert/strict");
import { test } from "node:test";
import { PersonalDictionaryStore } from "../../src/application/personalDictionaryStore";

/** A stand-in for VS Code's memento, which is all the store asks for. */
function fakeState(initial: Record<string, unknown> = {}) {
  const values = { ...initial };
  return {
    get: <T>(key: string): T | undefined => values[key] as T | undefined,
    update: (key: string, value: unknown): PromiseLike<void> => {
      values[key] = value;
      return Promise.resolve();
    },
    raw: (): Record<string, unknown> => values,
  };
}

test("a word accepted in one session is known in the next", async () => {
  const state = fakeState();
  const first = new PersonalDictionaryStore(state);
  assert.equal(first.add("visp"), true);
  await first.flush();

  const second = new PersonalDictionaryStore(state);
  assert.deepEqual(second.words, ["visp"], "it survived the store being rebuilt");
});

test("accepting the same word twice writes once", () => {
  const store = new PersonalDictionaryStore(fakeState());
  assert.equal(store.add("kubernetes"), true);
  assert.equal(store.add("Kubernetes"), false, "casing is not a different word");
  assert.deepEqual(store.words, ["kubernetes"]);
});

test("contractions and accented words are accepted; anything else is not", () => {
  const store = new PersonalDictionaryStore(fakeState());
  assert.equal(store.add("o'clock"), true);
  assert.equal(store.add("naïve"), true);
  for (const rubbish of ["", "   ", "two words", "code()", "a-b", "x1", "a".repeat(65)]) {
    assert.equal(store.add(rubbish), false, `should refuse ${JSON.stringify(rubbish)}`);
  }
  assert.deepEqual(store.words, ["o'clock", "naïve"]);
});

/*
 * A store written to for months and loaded on every activation. The oldest word goes rather
 * than the newest being refused: refusing would stop the feature working with nothing to say
 * why, which is the worse failure of the two.
 */
test("the dictionary does not grow without bound", async () => {
  // Letters only, because a word carrying a digit is refused — as the case above asserts.
  const wordFor = (index: number): string => {
    let letters = "";
    let value = index;
    do {
      letters = String.fromCharCode(97 + (value % 26)) + letters;
      value = Math.floor(value / 26);
    } while (value > 0);
    return `w${letters}`;
  };

  const state = fakeState();
  const store = new PersonalDictionaryStore(state);
  for (let index = 0; index < 5_050; index += 1) store.add(wordFor(index));
  await store.flush();

  assert.equal(store.words.length, 5_000);
  assert.equal(store.words.includes(wordFor(5_049)), true, "the newest is kept");
  assert.equal(store.words.includes(wordFor(0)), false, "the oldest went");
});

test("a corrupt or foreign stored value degrades to an empty dictionary", () => {
  for (const stored of [undefined, null, 42, "nope", {}, { schemaVersion: 99, words: ["x"] },
                        { schemaVersion: 1, words: "not an array" }]) {
    const store = new PersonalDictionaryStore(
      fakeState({ "vispNotes.personalDictionary.v1": stored }),
    );
    assert.deepEqual(store.words, [], `for ${JSON.stringify(stored) ?? "undefined"}`);
  }
});

test("rubbish inside a valid envelope is dropped rather than loaded", () => {
  const store = new PersonalDictionaryStore(fakeState({
    "vispNotes.personalDictionary.v1": {
      schemaVersion: 1,
      words: ["good", 7, "two words", null, "ALSOGOOD"],
    },
  }));
  assert.deepEqual(store.words, ["good", "alsogood"]);
});

test("a failed write is reported rather than thrown at the caller", async () => {
  const failures: unknown[] = [];
  const store = new PersonalDictionaryStore(
    {
      get: () => undefined,
      update: () => Promise.reject(new Error("disk full")),
    },
    (error) => failures.push(error),
  );

  assert.equal(store.add("visp"), true, "the word is still accepted for this session");
  await store.flush();
  assert.equal(failures.length, 1);
});
