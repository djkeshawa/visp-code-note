import assert = require("node:assert/strict");
import { test } from "node:test";
import { proseWordCount } from "../../src/application/proseWordCount";
import { wordCountLabel } from "../../src/webview/editor/wordCount";

/**
 * A word count for a notes file, which is mostly not prose.
 *
 * The number is only worth showing if it is the number the reader would get counting by hand.
 * Counting the source instead means frontmatter, a code sample and the markers a task carries
 * all inflate it, and the reader who checks a draft against a limit is misled by a figure that
 * is confidently wrong.
 */

test("prose is counted the way a reader would count it", () => {
  assert.equal(proseWordCount("One two three."), 3);
  assert.equal(proseWordCount(""), 0);
  assert.equal(proseWordCount("   \n\n  "), 0);
});

test("a contraction, a hyphenated word and a number are each one word", () => {
  assert.equal(proseWordCount("It doesn't matter."), 3);
  assert.equal(proseWordCount("A state-of-the-art result."), 3);
  assert.equal(proseWordCount("It cost 42 pounds."), 4);
});

test("markdown syntax is not words", () => {
  assert.equal(proseWordCount("## A heading"), 2);
  assert.equal(proseWordCount("- a bullet"), 2);
  assert.equal(proseWordCount("> a quote"), 2);
  assert.equal(proseWordCount("**bold** and *emphasis*"), 3);
  assert.equal(proseWordCount("---"), 0);
  assert.equal(proseWordCount("| Name | Role |\n| --- | --- |\n| Ada | maths |"), 4);
});

test("frontmatter is configuration, not writing", () => {
  const note = [
    "---",
    "title: A Long Title Nobody Wrote",
    "tags: [alpha, beta]",
    "---",
    "Two words.",
  ].join("\n");
  assert.equal(proseWordCount(note), 2);
});

test("a fenced code block is code, however much of it there is", () => {
  const note = [
    "Before.",
    "",
    "```ts",
    "const value = computeSomething(withAnArgument, andAnother);",
    "```",
    "",
    "After.",
  ].join("\n");
  assert.equal(proseWordCount(note), 2);
});

test("a task's markers are syntax, and its text is not", () => {
  assert.equal(
    proseWordCount("- [ ] Write the report @due(2026-08-14) @priority(high)"),
    3,
    "write, the, report",
  );
  assert.equal(
    proseWordCount("- [x] Done <!-- task:0b7f1c2e -->"),
    1,
    "the id the extension writes is not something anyone typed",
  );
});

test("a link counts what is read, not what it points at", () => {
  assert.equal(
    proseWordCount("See the [project charter](https://example.com/very/long/path)."),
    4,
    "see, the, project, charter",
  );
  assert.equal(proseWordCount("See [[Atlas]] for more."), 4);
  assert.equal(
    proseWordCount("See [[Some Long File Name|the atlas]] for more."),
    5,
    "the alias is what is read; the file name behind it is not",
  );
});

test("a tag is an address and a span of code is code", () => {
  assert.equal(proseWordCount("Ship it #release #q3"), 2);
  assert.equal(proseWordCount("Call `computeEverything()` first."), 2);
});

test("the footer says the count the way the other views say theirs", () => {
  assert.equal(wordCountLabel({ total: 0 }), "0 words");
  assert.equal(wordCountLabel({ total: 1 }), "1 word");
  assert.equal(wordCountLabel({ total: 240 }), "240 words");
  assert.equal(wordCountLabel({ total: 240, selected: 12 }), "12 of 240 words selected");
});

test("a long note counts in one pass over it", () => {
  const note = "Some ordinary prose on a line.\n".repeat(20_000);
  const started = process.hrtime.bigint();
  const words = proseWordCount(note);
  const elapsed = Number(process.hrtime.bigint() - started) / 1e6;

  assert.equal(words, 6 * 20_000);
  // Counted whenever the typing pauses, so it must not be quadratic in the note.
  assert.ok(elapsed < 1_000, `600,000 words took ${elapsed.toFixed(0)}ms`);
});
