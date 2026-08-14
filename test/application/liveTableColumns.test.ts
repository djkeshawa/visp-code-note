import assert = require("node:assert/strict");
import { test } from "node:test";
// Must come first: it installs the globals `@codemirror/view` reads while loading.
import { createHost } from "../support/domEnvironment";
import { CodeMirrorEditor } from "../../src/webview/editor/codeMirrorEditor";

/**
 * What a table does while it is being edited, read off the rendered lines.
 *
 * Live mode lines a table's columns up by giving every cell the width of the widest cell in
 * its column. Measuring that from the text on every keystroke meant the whole grid stepped
 * sideways one character at a time while a long cell was typed, and stepped back while it was
 * deleted. Readers report that as a bug; it is the only part of the editor that visibly moves
 * under the caret.
 */

interface OpenTable {
  readonly caretTo: (offset: number) => void;
  readonly caretToLine: (line: number) => void;
  readonly type: (text: string) => void;
  /** An edit that does not move the caret, the way a change on disk arrives. */
  readonly editAt: (offset: number, text: string) => void;
  readonly widthsOnLine: (line: number) => readonly string[];
}

interface MountedView {
  readonly contentDOM: HTMLElement;
  readonly state: {
    readonly selection: { readonly main: { readonly from: number; readonly to: number } };
    readonly doc: { line: (number: number) => { readonly from: number } };
  };
  readonly dispatch: (spec: unknown) => void;
}

function openNote(source: string): OpenTable {
  const editor = new CodeMirrorEditor(createHost(), "test-nonce", source, {
    suggestions: () => [],
    workspaceTags: () => [],
    unresolvedLinks: () => new Set<string>(),
    sourcePatched: () => undefined,
    saveRequested: () => undefined,
    openLink: () => undefined,
    openExternal: () => undefined,
    noteTitle: () => "Atlas",
  });
  const view = (editor as unknown as { view: MountedView }).view;

  return {
    caretTo(offset) {
      view.dispatch({ selection: { anchor: offset } });
    },
    caretToLine(line) {
      view.dispatch({ selection: { anchor: view.state.doc.line(line).from } });
    },
    type(text) {
      const { from, to } = view.state.selection.main;
      view.dispatch({
        changes: { from, to, insert: text },
        selection: { anchor: from + text.length },
        userEvent: "input.type",
      });
    },
    editAt(offset, text) {
      view.dispatch({ changes: { from: offset, insert: text } });
    },
    /** The column widths actually drawn on one rendered line, in order. */
    widthsOnLine(line) {
      const rendered = view.contentDOM.querySelectorAll(".cm-line")[line];
      assert.ok(rendered !== undefined, `line ${line} was not rendered`);
      return Array.from(rendered.querySelectorAll(".live-table-cell"))
        .map((cell) => cell.getAttribute("style") ?? "");
    },
  };
}

const TABLE = [
  "| Name | Role |",
  "| --- | --- |",
  "| Ada | maths |",
  "| Bob | ops |",
  "",
  "After the table.",
].join("\n");

/** The prose beneath the table, which is where the caret goes to leave it. */
const OUTSIDE = 6;

/** Just inside the first body cell, on `Ada`. */
const INSIDE_ADA = TABLE.indexOf("Ada") + 3;

test("the columns hold still while a cell is being typed", () => {
  const note = openNote(TABLE);
  note.caretTo(INSIDE_ADA);
  const before = note.widthsOnLine(3);
  assert.ok(before.length > 0, "the row below the caret is drawn as a grid");

  note.type(" Lovelace of Kirkby Mallory");

  assert.deepEqual(
    note.widthsOnLine(3),
    before,
    "the rest of the table moved sideways while one of its cells was typed",
  );
});

test("the columns take their new width once the caret leaves the table", () => {
  const note = openNote(TABLE);
  note.caretTo(INSIDE_ADA);
  const before = note.widthsOnLine(3);

  note.type(" Lovelace of Kirkby Mallory");
  note.caretToLine(OUTSIDE);

  assert.notDeepEqual(
    note.widthsOnLine(3),
    before,
    "the grid never caught up with the cell that had grown",
  );
});

test("an edit arriving while the caret is elsewhere is measured at once", () => {
  const note = openNote(TABLE);
  note.caretToLine(OUTSIDE);
  const before = note.widthsOnLine(3);

  // What a change on disk looks like: the text grows, the caret stays outside the table.
  note.editAt(INSIDE_ADA, " Lovelace of Kirkby Mallory");

  assert.notDeepEqual(
    note.widthsOnLine(3),
    before,
    "a table nobody has the caret in did not follow its own text",
  );
});
