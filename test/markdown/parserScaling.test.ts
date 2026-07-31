import assert = require("node:assert/strict");
import { test } from "node:test";
import { parseMarkdown } from "../../src/markdown/parser";
import { findMarkdownDestinationRanges } from "../../src/markdown/destinations";

/**
 * These guard the shape of the parse, not a stopwatch reading.
 *
 * Every input here once took time quadratic in its length, so a note a workspace could contain
 * — crafted or merely large — blocked the extension host for seconds to minutes while indexing,
 * and again on every keystroke while editing. The thresholds are far above what the fixed code
 * needs and far below what the quadratic versions took, so they catch a regression in the
 * algorithm without failing on a slow machine.
 */
function millisecondsToParse(source: string): number {
  const started = process.hrtime.bigint();
  parseMarkdown(source);
  return Number(process.hrtime.bigint() - started) / 1e6;
}

test("a note of unclosed link labels parses in linear time", () => {
  // Took ~1440s at this size before labels were paired off in a single pass.
  const elapsed = millisecondsToParse("[a".repeat(500_000));
  assert.ok(elapsed < 4_000, `1MB of unclosed labels took ${elapsed.toFixed(0)}ms`);
});

test("a note of unclosed link destinations parses in linear time", () => {
  const withoutClose = millisecondsToParse("[a](".repeat(250_000));
  assert.ok(withoutClose < 4_000, `1MB of unclosed destinations took ${withoutClose.toFixed(0)}ms`);

  // A single closing paren far away must not put the scan back into rescanning the line.
  const withClose = millisecondsToParse(`${"[a](".repeat(250_000)})`);
  assert.ok(withClose < 4_000, `1MB with a trailing paren took ${withClose.toFixed(0)}ms`);
});

test("quoted destinations do not reintroduce a per-bracket rescan", () => {
  const elapsed = millisecondsToParse('[a]("x'.repeat(160_000));
  assert.ok(elapsed < 4_000, `1MB of quoted destinations took ${elapsed.toFixed(0)}ms`);
});

test("a run of backslashes does not make escape checks quadratic", () => {
  // isEscapedAt walks backwards over the run, so this used to cost the run length per offset.
  const elapsed = millisecondsToParse(`${"\\".repeat(200)}[a`.repeat(500));
  assert.ok(elapsed < 2_000, `a backslash-heavy note took ${elapsed.toFixed(0)}ms`);
});

test("ordinary prose with a link and a tag on every line stays fast", () => {
  // The realistic case, and the slowest one before tags stopped rescanning every protected
  // range: half a megabyte of plausible notes took 2.3s.
  const elapsed = millisecondsToParse(
    "Some [link](https://example.com/page) and #tag text here.\n".repeat(9_000),
  );
  assert.ok(elapsed < 2_000, `500KB of ordinary prose took ${elapsed.toFixed(0)}ms`);
});

test("the scan limit only applies where a destination cannot be paired off", () => {
  // The whole construct is protected, and the URL inside it matches the bare-URL pass too.
  const short = findMarkdownDestinationRanges("[a](https://example.com/x)");
  assert.ok(
    short.some((range) => range.start === 0 && range.end === 26),
    "an ordinary destination is reported",
  );

  // A line with no quote is paired in the single pass, so length is no object.
  const long = findMarkdownDestinationRanges(`[a](${"x".repeat(4_000)})`);
  assert.ok(
    long.some((range) => range.start === 0),
    "a long destination on an unquoted line is still reported",
  );

  // A quote forces the scan, which is the only path that gives up — and only past its bound.
  assert.ok(
    findMarkdownDestinationRanges(`[a]("x")`).some((range) => range.start === 0),
    "a quoted destination within the bound is reported",
  );
  assert.equal(
    findMarkdownDestinationRanges(`[a]("${"x".repeat(4_000)}")`)
      .some((range) => range.start === 0),
    false,
    "a quoted destination past the bound is left unprotected rather than rescanned",
  );
});

test("prose using `<` as less-than parses in linear time", () => {
  /*
   * `findTagEnd` ran to the end of the document, and `findHtmlTagRanges` retries from the next
   * `<` after a failure, so every tag-like `<` with no `>` after it rescanned the remainder.
   * 672KB of this took 11.4s, quadrupling with each doubling.
   */
  const elapsed = millisecondsToParse("when a<b then something else happens here.\n".repeat(24_000));
  assert.ok(elapsed < 4_000, `1MB of inequalities took ${elapsed.toFixed(0)}ms`);
});

test("a note of unclosed wiki links parses in linear time", () => {
  // Took 161ms at a sixth of this size before `[[` was paired off in a single pass.
  const elapsed = millisecondsToParse("[[".repeat(500_000));
  assert.ok(elapsed < 4_000, `1MB of unclosed wiki links took ${elapsed.toFixed(0)}ms`);
});

test("tasks below many fenced blocks parse in linear time", () => {
  /*
   * Every line asked the whole excluded-range list whether it was covered, so a note's lines
   * and its fenced blocks multiplied. 375KB took 1.5s.
   */
  const source = `${"```\nx\n```\n\n".repeat(30_000)}${"- [ ] a task\n".repeat(30_000)}`;
  const elapsed = millisecondsToParse(source);
  assert.ok(elapsed < 4_000, `a fence-heavy note took ${elapsed.toFixed(0)}ms`);
});
