import assert = require("node:assert/strict");
import { test } from "node:test";
// Must come first: it installs the globals `@codemirror/view` reads while loading.
import { createHost, window } from "../support/domEnvironment";
import { CodeMirrorEditor } from "../../src/webview/editor/codeMirrorEditor";
import { INLINE_MARKS } from "../../src/webview/editor/inlineMarks";

/**
 * The formatting keys, pressed.
 *
 * The planner is tested on its own; these press real keys at a real editor, because a command
 * can be perfectly correct and bound to nothing at all. Each one is a sentence a writer would
 * say about their keyboard.
 */

interface OpenNote {
  readonly press: (key: string, options?: { readonly shift?: boolean }) => KeyboardEvent;
  readonly select: (from: number, to: number) => void;
  readonly type: (text: string) => void;
  readonly setReadOnly: (readOnly: boolean) => void;
  readonly text: () => string;
}

function openNote(source: string): OpenNote {
  const editor = new CodeMirrorEditor(createHost(), "test-nonce", source, {
    suggestions: () => [],
    unresolvedLinks: () => new Set<string>(),
    sourcePatched: () => undefined,
    saveRequested: () => undefined,
    openLink: () => undefined,
    openExternal: () => undefined,
    noteTitle: () => "Atlas",
  });
  const view = (editor as unknown as {
    view: {
      contentDOM: HTMLElement;
      dispatch: (spec: unknown) => void;
      state: { selection: { main: { from: number; to: number } } };
    };
  }).view;

  return {
    press(key, options = {}) {
      const shift = options.shift ?? false;
      const event = new window.KeyboardEvent("keydown", {
        key: shift ? key.toUpperCase() : key,
        code: `Key${key.toUpperCase()}`,
        ctrlKey: true,
        shiftKey: shift,
        bubbles: true,
        cancelable: true,
      });
      /*
       * A real keydown carries the physical key as well as the character it produced, and the
       * editor resolves a shifted binding through the key code. jsdom leaves it at zero, which
       * loses every shifted binding silently.
       */
      if (event.keyCode === 0) {
        Object.defineProperty(event, "keyCode", { value: key.toUpperCase().charCodeAt(0) });
      }
      view.contentDOM.dispatchEvent(event);
      return event;
    },
    select(from, to) {
      view.dispatch({ selection: { anchor: from, head: to } });
    },
    type(text) {
      const { from, to } = view.state.selection.main;
      view.dispatch({
        changes: { from, to, insert: text },
        selection: { anchor: from + text.length },
        userEvent: "input.type",
      });
    },
    setReadOnly: (readOnly) => { editor.setReadOnly(readOnly); },
    text: () => editor.source,
  };
}

test("Ctrl+B bolds the selected word", () => {
  const note = openNote("Atlas is a note.\n");
  note.select(0, 5);

  note.press("b");
  assert.equal(note.text(), "**Atlas** is a note.\n");
});

test("Ctrl+B again takes the bold off, without the asterisks ever being visible", () => {
  const note = openNote("**Atlas** is a note.\n");
  note.select(4, 4);

  note.press("b");
  assert.equal(note.text(), "Atlas is a note.\n");
});

test("Ctrl+I italicises and Ctrl+I again removes it", () => {
  const note = openNote("Atlas is a note.\n");
  note.select(0, 5);

  note.press("i");
  assert.equal(note.text(), "*Atlas* is a note.\n");

  note.select(1, 6);
  note.press("i");
  assert.equal(note.text(), "Atlas is a note.\n");
});

test("Ctrl+E marks code", () => {
  const note = openNote("run npm test now\n");
  note.select(4, 12);

  note.press("e");
  assert.equal(note.text(), "run `npm test` now\n");
});

test("Ctrl+Shift+X strikes text through", () => {
  const note = openNote("drop this line\n");
  note.select(5, 9);

  note.press("x", { shift: true });
  assert.equal(note.text(), "drop ~~this~~ line\n");
});

test("one toggle is one undo, not one undo per delimiter", () => {
  const note = openNote("Atlas is a note.\n");
  note.select(0, 5);
  note.press("b");
  assert.equal(note.text(), "**Atlas** is a note.\n", "precondition — the bold was applied");

  note.press("z");
  assert.equal(
    note.text(),
    "Atlas is a note.\n",
    "a single Ctrl+Z put the whole toggle back",
  );
});

test("a toggle is never folded into the words typed just before it", () => {
  /*
   * Typed, then Ctrl+B straight away with no selection in between — which is how a writer
   * turns bold on mid-sentence. The history joins consecutive `input.type` transactions that
   * touch, so a toggle that called itself typing would disappear along with the word when the
   * writer pressed Ctrl+Z once.
   */
  const note = openNote("");
  note.select(0, 0);
  note.type("Atlas");
  note.press("b");
  assert.equal(note.text(), "Atlas****", "precondition — typed, then opened a bold pair");

  note.press("z");
  assert.equal(
    note.text(),
    "Atlas",
    "one undo took back the toggle and left the word that was typed before it",
  );
});

test("a formatting key inside a code fence is left for the command underneath", () => {
  const note = openNote("```js\nconst x = 1;\n```\n");
  note.select(6, 11);

  const event = note.press("b");
  assert.equal(note.text(), "```js\nconst x = 1;\n```\n", "the fence is untouched");
  assert.equal(event.defaultPrevented, false, "the key was not swallowed");
});

test("a note frozen by a draft conflict refuses the formatting keys", () => {
  const note = openNote("Atlas is a note.\n");
  note.setReadOnly(true);
  note.select(0, 5);

  note.press("b");
  assert.equal(note.text(), "Atlas is a note.\n", "nothing the keyboard did reached the note");
});

test("every mark in the table is actually reachable from the keyboard", () => {
  for (const mark of INLINE_MARKS) {
    const note = openNote("word here\n");
    note.select(0, 4);
    const parts = mark.key.split("-");
    const letter = parts[parts.length - 1] ?? "";
    note.press(letter, { shift: parts.includes("Shift") });
    assert.equal(
      note.text(),
      `${mark.open}word${mark.close} here\n`,
      `${mark.label} is declared on ${mark.key} but pressing it did nothing`,
    );
  }
});
