import assert = require("node:assert/strict");
import { test } from "node:test";
import { parseMarkdown } from "../../src/markdown/parser";
import { tableBlocks } from "../../src/markdown/tables";
import { titleToFileName } from "../../src/domain/normalization";
import { parseTasks } from "../../src/markdown/tasks";
import { scanLines } from "../../src/markdown/lines";
import { reminderKey } from "../../src/application/dueDate";
import { ReminderStore } from "../../src/application/reminderStore";

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

/*
 * A note's frontmatter keys are workspace content. `__proto__` is the one key whose assignment
 * has meaning beyond adding a property, and against an ordinary object literal it replaces
 * what the parsed object inherits from. Nothing reads frontmatter by an attacker-chosen key
 * today, so this was never exploitable — the point is that it stops depending on that.
 */
test("a __proto__ key in frontmatter reaches no prototype", () => {
  const parsed = parseMarkdown("---\n__proto__:\n  - x\ntitle: Real\n---\n# H\n");

  assert.equal(Object.getPrototypeOf(parsed.frontmatter), null);
  assert.equal(({} as Record<string, unknown>)["length"], undefined, "Object.prototype is clean");
  assert.equal(parsed.title, "Real", "and the real properties are still read");
});

test("a title's control characters do not reach the file system", () => {
  const nul = String.fromCharCode(0);
  const del = String.fromCharCode(0x7f);

  assert.equal(titleToFileName(`a${nul}b`), "ab.md");
  assert.equal(titleToFileName(`a${del}b`), "ab.md");
  // Ordinary titles are untouched, and the existing protections still apply.
  assert.equal(titleToFileName("My Note - draft"), "My Note - draft.md");
  assert.equal(titleToFileName("a/b"), "a-b.md");
  assert.equal(titleToFileName("CON"), "CON_.md");
});

/*
 * The worst of the set: `\s*([^)]+?)\s*` inside `@due(…)` is three mutually ambiguous
 * quantifiers, and a task line is read for every note during indexing and again on every
 * keystroke in an open one. It was cubic — 2,000 spaces took five seconds, 4,000 took forty.
 */
test("an unclosed @due( followed by a huge run of spaces parses promptly", () => {
  const source = `- [ ] job @due(${" ".repeat(200_000)}x\n`;
  const elapsed = millisecondsFor(() => {
    const tasks = parseTasks(source, scanLines(source), []);
    assert.equal(tasks.length, 1, "it is still read as a task");
    assert.equal(tasks[0]?.due, undefined, "with no due date, since the marker never closes");
  });
  assert.ok(elapsed < BUDGET_MS, `took ${elapsed}ms, which suggests the ambiguous quantifiers`);
});

test("a well-formed due and remind are still read, and an empty one is not a date", () => {
  const source = "- [ ] a @due( 2026-09-01 ) @remind(2h)\n- [ ] b @due()\n";
  const tasks = parseTasks(source, scanLines(source), []);
  assert.equal(tasks[0]?.due, "2026-09-01", "surrounding spaces are still trimmed");
  assert.equal(tasks[0]?.remind, "2h");
  assert.equal(tasks[1]?.due, undefined, "an empty marker is no due date rather than a blank one");
});

/*
 * A task id is written by the extension, but a note can carry any `<!-- task:… -->` it likes.
 * An id past the store's key budget was refused outright, which meant the reminder was never
 * recorded as delivered and fired again on every index change — as a toast that does not
 * auto-dismiss.
 */
test("a reminder for a task with an absurd id is still remembered as delivered", () => {
  const key = reminderKey("file:///n.md", "a".repeat(5_000), 1_234_567);
  const store = new ReminderStore(undefined, () => undefined);

  store.markDelivered([key]);
  assert.equal(store.has(key), true, "or the toast repeats forever");
  assert.notEqual(
    key,
    reminderKey("file:///n.md", "b".repeat(5_000), 1_234_567),
    "and two different tasks are still two different reminders",
  );
});
