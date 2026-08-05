import assert = require("node:assert/strict");
import { test } from "node:test";
import { parseMarkdown } from "../../src/markdown/parser";
import { tableBlocks } from "../../src/markdown/tables";

/**
 * A note is workspace content, and this extension declares that it supports untrusted
 * workspaces — so a cloned repository decides what the parser is handed. Everything here is
 * shaped to be hostile rather than large: each input used to take seconds to minutes through
 * a quadratic path, and each now finishes in milliseconds.
 *
 * The budgets are deliberately loose. What is being caught is a return to quadratic
 * behaviour, which shows up as seconds against inputs like these, so a hundredfold margin
 * still catches it while leaving nothing for a slow or loaded machine to trip over.
 */

function millisecondsFor(work: () => void): number {
  const started = Date.now();
  work();
  return Date.now() - started;
}

const BUDGET_MS = 2_000;

/*
 * Indexing runs on startup, so this one needs nobody to open anything: cloning the repository
 * is enough. It took 6.3 seconds at 100,000 spaces and grew with the square of the run.
 */
test("a heading padded with a huge run of spaces parses promptly", () => {
  const note = `# Notes${" ".repeat(300_000)}\n\nbody\n`;
  const elapsed = millisecondsFor(() => {
    const parsed = parseMarkdown(note);
    assert.equal(parsed.headings[0]?.text, "Notes", "and still reads as the heading it is");
  });
  assert.ok(elapsed < BUDGET_MS, `took ${elapsed}ms, which suggests quadratic scanning`);
});

test("a heading's closing sequence is still stripped, and a bare trailing hash is not", () => {
  const cases: readonly (readonly [string, string])[] = [
    ["## Notes ##", "Notes"],
    ["## Notes   ###   ", "Notes"],
    ["# foo#", "foo#"],
    ["# foo #bar", "foo #bar"],
    ["## Notes", "Notes"],
    ["#", ""],
  ];
  for (const [source, expected] of cases) {
    assert.equal(parseMarkdown(`${source}\n`).headings[0]?.text, expected, source);
  }
});

/*
 * Frontmatter is parsed for every note during indexing too. Rebuilding the list per item made
 * 20,000 aliases cost two and a half seconds.
 */
test("frontmatter holding a huge sequence parses promptly and keeps every item", () => {
  const items = 100_000;
  const note = `---\naliases:\n${"  - a\n".repeat(items)}---\n# T\n`;
  const elapsed = millisecondsFor(() => {
    const parsed = parseMarkdown(note);
    assert.equal(parsed.aliases.length, items, "every alias survives");
  });
  assert.ok(elapsed < BUDGET_MS, `took ${elapsed}ms, which suggests quadratic copying`);
});

test("frontmatter lists keep their order and their values", () => {
  const parsed = parseMarkdown("---\naliases:\n  - first\n  - second\n  - third\n---\n# T\n");
  assert.deepEqual(parsed.aliases, ["first", "second", "third"]);
});

/*
 * Reached from the note renderer rather than from indexing, so it freezes the editor pane
 * rather than the window — 2.1 seconds at 50,000 spaces, and rising with the square.
 */
test("a line of spaces that is not a delimiter row is rejected promptly", () => {
  const lines = ["a|b", `${" ".repeat(500_000)}-x`];
  const elapsed = millisecondsFor(() => {
    assert.deepEqual(tableBlocks(lines), [], "and is not read as a table");
  });
  assert.ok(elapsed < BUDGET_MS, `took ${elapsed}ms, which suggests quadratic backtracking`);
});

test("real delimiter rows are still recognised, and near misses still rejected", () => {
  const isTable = (delimiter: string): boolean =>
    tableBlocks(["Name | Tag", delimiter, "a | b"]).length > 0;

  for (const delimiter of ["--- | ---", "| --- | --- |", "|:---|---:|", " :-: | :-: ", "-|-"]) {
    assert.equal(isTable(delimiter), true, `should be a delimiter: ${JSON.stringify(delimiter)}`);
  }
  for (const delimiter of ["--- | abc", "abc", "--- |-- x", "| |"]) {
    assert.equal(isTable(delimiter), false, `should not be a delimiter: ${JSON.stringify(delimiter)}`);
  }
});
