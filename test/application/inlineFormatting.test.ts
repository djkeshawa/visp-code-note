import assert = require("node:assert/strict");
import { test } from "node:test";
import { EditorSelection, EditorState } from "@codemirror/state";
import { ensureSyntaxTree } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { planInlineFormat } from "../../src/webview/editor/inlineFormatting";
import { INLINE_MARKS, keyHint } from "../../src/webview/editor/inlineMarks";
import { markdownContext } from "../../src/webview/editor/markdownContext";

/**
 * What one press of a formatting key does to a note, decided as a pure function of the state.
 *
 * Each case is written the way a reader would describe it — "I selected the word and pressed
 * bold" — and reads the whole document back, because the mark that matters is the one that
 * ends up in the file.
 */

const MARK = Object.fromEntries(
  INLINE_MARKS.map((mark) => [mark.id, mark] as const),
);

function stateFor(doc: string, from: number, to = from): EditorState {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.single(from, to),
    extensions: [markdown({ base: markdownLanguage }), markdownContext],
  });
  // The plan reads the parse tree, and a state built outside a view has only parsed as far as
  // its own time budget allowed. Short test notes finish instantly; this makes that certain.
  ensureSyntaxTree(state, doc.length, 5_000);
  return state;
}

interface Applied {
  readonly doc: string;
  readonly selected: string;
  readonly caret: number;
}

/** Applies the plan and reads back what the reader would see. */
function press(id: keyof typeof MARK, doc: string, from: number, to = from): Applied | undefined {
  const mark = MARK[id];
  assert.ok(mark, `no such mark: ${id}`);
  const state = stateFor(doc, from, to);
  const plan = planInlineFormat(state, mark.open, mark.close);
  if (plan === undefined) return undefined;
  const next = state.update({ changes: plan.changes, selection: plan.selection }).state;
  return {
    doc: next.doc.toString(),
    selected: next.sliceDoc(next.selection.main.from, next.selection.main.to),
    caret: next.selection.main.head,
  };
}

test("bolding a selected word wraps it and leaves the word selected", () => {
  const result = press("bold", "Atlas is a note.\n", 0, 5);

  assert.equal(result?.doc, "**Atlas** is a note.\n");
  assert.equal(result?.selected, "Atlas", "the reader's own selection survives the toggle");
});

test("pressing bold again on the bold word takes the marks off", () => {
  const result = press("bold", "**Atlas** is a note.\n", 2, 7);

  assert.equal(result?.doc, "Atlas is a note.\n");
  assert.equal(result?.selected, "Atlas");
});

test("un-bolding works from a caret alone, which is the only way Live mode allows", () => {
  // Live mode hides the asterisks on an inactive line, so there is nothing to select: the
  // reader clicks in the word and presses the key.
  const result = press("bold", "**Atlas** is a note.\n", 4);

  assert.equal(result?.doc, "Atlas is a note.\n");
  assert.equal(result?.caret, 2, "the caret stays on the same letter it was on");
});

test("un-bolding also works when the selection takes the marks with it", () => {
  const result = press("bold", "**Atlas** is a note.\n", 0, 9);

  assert.equal(result?.doc, "Atlas is a note.\n");
  assert.equal(result?.selected, "Atlas");
});

test("bold with nothing selected writes the pair and parks the caret inside it", () => {
  const result = press("bold", "Write here: \n", 12);

  assert.equal(result?.doc, "Write here: ****\n");
  assert.equal(result?.caret, 14, "the caret is between the two delimiters, ready to type");
});

test("a selection padded with spaces marks the word, not the padding", () => {
  // `**word **` is not bold in any renderer: the closing delimiter has to touch the text.
  const result = press("bold", "one two three\n", 3, 8);

  assert.equal(result?.doc, "one **two** three\n");
});

test("a selection that is nothing but spaces writes an empty pair", () => {
  const result = press("bold", "one   two\n", 3, 6);

  assert.equal(result?.doc, "one****   two\n");
  assert.equal(result?.caret, 5);
});

test("italic inside bold nests rather than breaking the bold", () => {
  const result = press("italic", "**Atlas** is a note.\n", 2, 7);

  assert.equal(result?.doc, "***Atlas*** is a note.\n");
});

test("bold inside italic nests the other way round", () => {
  const result = press("bold", "*Atlas* is a note.\n", 1, 6);

  assert.equal(result?.doc, "***Atlas*** is a note.\n");
});

test("taking bold off doubly marked text leaves the italic behind", () => {
  const result = press("bold", "***Atlas*** is a note.\n", 3, 8);

  assert.equal(result?.doc, "*Atlas* is a note.\n");
  assert.equal(result?.selected, "Atlas");
});

test("taking italic off doubly marked text leaves the bold behind", () => {
  const result = press("italic", "***Atlas*** is a note.\n", 3, 8);

  assert.equal(result?.doc, "**Atlas** is a note.\n");
});

test("a selection running over the end of a bold run never writes a lone delimiter", () => {
  // Starts inside `**bold**` and finishes outside it. Wrapping as-is would put a `**` in the
  // middle of a sentence with no partner, which renders as two literal asterisks.
  const result = press("bold", "**bold** and more\n", 4, 17);

  assert.equal(result?.doc, "**bold and more**\n");
  assert.equal(
    (result?.doc.match(/\*\*/g) ?? []).length,
    2,
    "exactly one balanced pair is written",
  );
});

test("a selection already containing the marks as text is not double-marked", () => {
  const result = press("bold", "say **this** now\n", 0, 16);

  assert.equal(result?.doc, "**say this now**\n");
});

test("code formatting toggles backticks the same way", () => {
  const added = press("inline-code", "run npm test now\n", 4, 12);
  assert.equal(added?.doc, "run `npm test` now\n");

  const removed = press("inline-code", "run `npm test` now\n", 5, 13);
  assert.equal(removed?.doc, "run npm test now\n");
});

test("strikethrough toggles a two-character delimiter", () => {
  const added = press("strikethrough", "drop this line\n", 5, 9);
  assert.equal(added?.doc, "drop ~~this~~ line\n");

  const removed = press("strikethrough", "drop ~~this~~ line\n", 7, 11);
  assert.equal(removed?.doc, "drop this line\n");
});

test("a selection inside a fenced code block is left alone", () => {
  const doc = "```js\nconst x = 1;\n```\n";
  assert.equal(press("bold", doc, 6, 11), undefined, "the marks mean nothing to a code fence");
  assert.equal(press("inline-code", doc, 6, 11), undefined);
});

test("a selection in frontmatter is left alone", () => {
  const doc = "---\ntitle: Atlas\n---\n\nProse.\n";

  assert.equal(press("bold", doc, 11, 16), undefined, "frontmatter is configuration, not prose");
});

test("a selection spanning a paragraph break is left alone", () => {
  // `**` either side of a blank line renders as literal asterisks, so writing them is a lie.
  const doc = "First para.\n\nSecond para.\n";

  assert.equal(press("bold", doc, 0, 25), undefined);
});

test("a selection over several lines of one paragraph is marked as one run", () => {
  const doc = "one two\nthree four\n";

  assert.equal(press("bold", doc, 0, 18)?.doc, "**one two\nthree four**\n");
});

test("a read-only note refuses the toggle so the key falls through", () => {
  const state = EditorState.create({
    doc: "Atlas is a note.\n",
    selection: EditorSelection.single(0, 5),
    extensions: [markdown({ base: markdownLanguage }), markdownContext, EditorState.readOnly.of(true)],
  });
  ensureSyntaxTree(state, state.doc.length, 5_000);

  assert.equal(planInlineFormat(state, "**", "**"), undefined);
});

test("the marks a writer reaches for are all four, each on a key of its own", () => {
  assert.deepEqual(
    INLINE_MARKS.map((mark) => mark.id),
    ["bold", "italic", "inline-code", "strikethrough"],
  );
  assert.equal(
    new Set(INLINE_MARKS.map((mark) => mark.key)).size,
    INLINE_MARKS.length,
    "two marks on one key means one of them can never be pressed",
  );
});

test("a formatting key is never one the extension already contributed to VS Code", () => {
  /*
   * vispNotes.showBacklinks is contributed on ctrl+shift+b with
   * `activeCustomEditorId == vispNotes.noteEditor` — in the note editor. A mark bound there
   * would repeat the Ctrl+Shift+G defect: one key, two things, neither of them deliberate.
   */
  const contributed = new Set(["Mod-Shift-b", "Mod-Shift-g", "Shift-Alt-l", "Shift-Alt-n"]);

  for (const mark of INLINE_MARKS) {
    assert.equal(
      contributed.has(mark.key),
      false,
      `${mark.label} is on ${mark.key}, which the extension already contributes`,
    );
  }
});

test("Mod-k stays free, because outline folding hangs two chords off it", () => {
  for (const mark of INLINE_MARKS) {
    assert.notEqual(mark.key, "Mod-k", `${mark.label} would swallow Mod-k Mod-0 and Mod-k Mod-j`);
  }
});

test("the hint column names one platform's key, in that platform's notation", () => {
  assert.equal(keyHint("Mod-b", false), "Ctrl+B");
  assert.equal(keyHint("Mod-b", true), "⌘B");
  assert.equal(keyHint("Mod-Shift-x", false), "Ctrl+Shift+X");
  assert.equal(keyHint("Shift-Alt-l", false), "Shift+Alt+L");
});

/**
 * Windows and Linux read the binding left to right; a Mac reads ⌃⌥⇧⌘ whatever the binding says.
 *
 * Both branches in this wave wrote Insert Link's Mac hint by hand and wrote it differently —
 * "⌘⌥L" from the key string, "⌥⌘L" from the platform convention. The convention wins, and it is
 * applied here rather than at each call site so the two cannot drift apart again.
 */
test("a Mac hint orders its glyphs the way every other menu on the machine does", () => {
  assert.equal(keyHint("Mod-Alt-l", true), "⌥⌘L");
  assert.equal(keyHint("Mod-Shift-x", true), "⇧⌘X");
  assert.equal(keyHint("Shift-Alt-l", true), "⌥⇧L");
  assert.equal(keyHint("Mod-Ctrl-Shift-Alt-p", true), "⌃⌥⇧⌘P");
});
