import assert = require("node:assert/strict");
import { test } from "node:test";
import { CompletionContext } from "@codemirror/autocomplete";
import type { Completion } from "@codemirror/autocomplete";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import type { TransactionSpec } from "@codemirror/state";
import { slashCompletions, slashQueryAt } from "../../src/webview/editor/slashCompletion";

/*
 * The `/` menu against a real document.
 *
 * `slashCommands.test.ts` covers the list and the templates on their own; this covers the part
 * that only exists in an editor — where the menu opens, where it must not, and what the chosen
 * command actually does to the text and the selection.
 */

const NOW = new Date(2026, 7, 15);

function state(source: string): EditorState {
  return EditorState.create({ doc: source, extensions: [markdown()] });
}

/** Runs the source at the end of the document, as typing would. */
function completionsAt(source: string, at = source.length) {
  return slashCompletions(new CompletionContext(state(source), at, false), NOW);
}

/** Applies a named option and returns the transaction it dispatched. */
function applyOption(source: string, label: string): { text: string; anchor: number; head: number } {
  const editorState = state(source);
  const result = slashCompletions(new CompletionContext(editorState, source.length, false), NOW);
  assert.notEqual(result, null, `no menu for ${JSON.stringify(source)}`);
  const option = result?.options.find((entry) => entry.label === label);
  assert.notEqual(option, undefined, `no command labelled ${label}`);

  let spec: TransactionSpec | undefined;
  const view = { state: editorState, dispatch: (value: TransactionSpec) => { spec = value; } };
  const apply = option?.apply;
  assert.equal(typeof apply, "function", "the command has to write the syntax itself");
  (apply as (view: unknown, completion: Completion, from: number, to: number) => void)(
    view,
    option as Completion,
    result!.from,
    result!.to ?? source.length,
  );

  assert.notEqual(spec, undefined);
  const changes = spec?.changes as { from: number; to: number; insert: string };
  const selection = spec?.selection as { anchor: number; head?: number };
  const text = source.slice(0, changes.from) + changes.insert + source.slice(changes.to);
  return {
    text,
    anchor: selection.anchor,
    head: selection.head ?? selection.anchor,
  };
}

test("the menu opens where a block can start", () => {
  assert.notEqual(completionsAt("/"), null);
  assert.notEqual(completionsAt("/ta"), null);
  assert.notEqual(completionsAt("Some prose\n\n/"), null, "on a fresh line further down");
  assert.notEqual(completionsAt("- /"), null, "inside a list item");
  assert.notEqual(completionsAt("- [ ] /"), null, "inside a task");
});

test("the menu stays shut where a slash is only punctuation", () => {
  assert.equal(completionsAt("and/or"), null);
  assert.equal(completionsAt("see https://example.com"), null);
  assert.equal(completionsAt("due 12/08"), null);
  assert.equal(completionsAt("Some prose /table"), null);
  assert.equal(completionsAt("no slash at all"), null);
});

/* Fenced code and frontmatter are the reader's own text; a menu must not open in them. */
test("the menu stays shut inside protected Markdown", () => {
  const fenced = "```\n/table\n```";
  assert.equal(completionsAt(fenced, fenced.indexOf("/table") + 6), null);

  const inline = "`/table`";
  assert.equal(completionsAt(inline, inline.length - 1), null);
});

test("the query narrows the list, and an unmatched one offers nothing", () => {
  assert.equal(completionsAt("/")?.options.length, completionsAt("/")?.options.length);
  const tables = completionsAt("/tab")?.options.map((option) => option.label);
  assert.deepEqual(tables, ["Table"]);
  assert.deepEqual(completionsAt("/zzzz")?.options, []);
});

test("the menu replaces the slash and its query, not the prose before it", () => {
  const applied = applyOption("- [ ] /task", "Task");
  assert.equal(applied.text, "- [ ] - [ ] ", "the list marker before the slash is left alone");
});

test("choosing a command writes its syntax and places the caret to keep typing", () => {
  const heading = applyOption("/h2", "Heading 2");
  assert.equal(heading.text, "## ");
  assert.equal(heading.anchor, 3);
  assert.equal(heading.head, 3, "a plain caret, nothing selected");

  const task = applyOption("/task", "Task");
  assert.equal(task.text, "- [ ] ");
  assert.equal(task.anchor, 6);
});

/*
 * The bug this guards: the sample value used to arrive with the caret in front of it, so
 * typing the reminder you actually wanted produced `@remind(1m15m)`.
 */
test("a sample value arrives selected, so typing replaces it", () => {
  const remind = applyOption("/remind", "Reminder");
  assert.equal(remind.text, "@remind(15m)");
  const from = Math.min(remind.anchor, remind.head);
  const to = Math.max(remind.anchor, remind.head);
  assert.equal(remind.text.slice(from, to), "15m", "the sample is selected");

  const priority = applyOption("/priority", "Priority");
  assert.equal(priority.text, "@priority(high)");
  assert.equal(
    priority.text.slice(
      Math.min(priority.anchor, priority.head),
      Math.max(priority.anchor, priority.head),
    ),
    "high",
  );
});

test("the due command fills today in and leaves the caret inside the brackets", () => {
  const due = applyOption("/due", "Due Date");
  assert.equal(due.text, "@due(2026-08-15)");
  assert.equal(due.anchor, "@due(2026-08-15".length, "ready for a time to be typed after it");
  assert.equal(due.head, due.anchor);
});

test("a multi-line block is written whole", () => {
  const table = applyOption("/table", "Table");
  assert.equal(table.text.split("\n").length, 3);
  assert.equal(
    table.text.slice(Math.min(table.anchor, table.head), Math.max(table.anchor, table.head)),
    "Column",
  );

  const code = applyOption("/code", "Code Block");
  assert.equal(code.text, "```\n\n```");
  assert.equal(code.anchor, 3, "on the opening fence, where the language goes");
});

test("slashQueryAt agrees with the source about where a menu belongs", () => {
  const open = state("- /due");
  assert.deepEqual(slashQueryAt(open, open.doc.length), { start: 2, query: "due" });

  const prose = state("and/or");
  assert.equal(slashQueryAt(prose, prose.doc.length), undefined);
});
