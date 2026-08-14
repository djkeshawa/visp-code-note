import assert = require("node:assert/strict");
import { test } from "node:test";
// Must come first: it installs the globals `@codemirror/view` reads while loading.
import { createHost, window } from "../support/domEnvironment";
import { CodeMirrorEditor } from "../../src/webview/editor/codeMirrorEditor";

/**
 * What each key has to do, driven through the real editor.
 *
 * These press keys and read the note back, which is the only way to find out whether a
 * binding is actually wired — a command can be perfectly correct and bound to nothing. Each
 * test is a sentence a reader would say about their keyboard.
 */

interface OpenEditor {
  readonly editor: CodeMirrorEditor;
  readonly press: (key: string, options?: KeyOptions) => void;
  readonly type: (text: string) => void;
  readonly caretTo: (offset: number) => void;
  readonly saveRequests: () => number;
  readonly openedLinks: () => readonly string[];
  readonly text: () => string;
}

interface KeyOptions {
  readonly ctrl?: boolean;
  readonly shift?: boolean;
  readonly alt?: boolean;
}

const NAMED_KEY_CODES: Readonly<Record<string, number>> = {
  Enter: 13, Tab: 9, Escape: 27, Backspace: 8, Delete: 46,
  ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40,
};

/** The physical key, which for a letter is its uppercase code point. */
function keyCodeFor(key: string): number {
  return key.length === 1 ? key.toUpperCase().charCodeAt(0) : NAMED_KEY_CODES[key] ?? 0;
}

function openNote(source: string): OpenEditor {
  let saveRequests = 0;
  const openedLinks: string[] = [];
  const editor = new CodeMirrorEditor(createHost(), "test-nonce", source, {
    suggestions: () => [],
    workspaceTags: () => [],
    unresolvedLinks: () => new Set<string>(),
    sourcePatched: () => undefined,
    saveRequested: () => { saveRequests += 1; },
    openLink: (target) => { openedLinks.push(target); },
    openExternal: () => undefined,
    noteTitle: () => "Atlas",
  });

  const view = (editor as unknown as { view: { contentDOM: HTMLElement; dispatch: (spec: unknown) => void } }).view;

  return {
    editor,
    press(key, options = {}) {
      const event = new window.KeyboardEvent("keydown", {
        key,
        code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
        ctrlKey: options.ctrl ?? false,
        shiftKey: options.shift ?? false,
        altKey: options.alt ?? false,
        bubbles: true,
        cancelable: true,
      });
      /*
       * A real keydown carries the physical key as well as the character it produced, and
       * CodeMirror needs both: to resolve Ctrl+Shift+Z it looks up the unshifted letter for
       * the key code. jsdom leaves `keyCode` at zero, which silently loses every shifted
       * binding — an absent property in the test, not an absent binding in the editor.
       */
      if (event.keyCode === 0) {
        Object.defineProperty(event, "keyCode", { value: keyCodeFor(key) });
      }
      view.contentDOM.dispatchEvent(event);
    },
    type(text) {
      const state = (editor as unknown as { view: { state: { selection: { main: { from: number; to: number } } } } }).view.state;
      const { from, to } = state.selection.main;
      view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length }, userEvent: "input.type" });
    },
    caretTo(offset) {
      view.dispatch({ selection: { anchor: offset } });
    },
    saveRequests: () => saveRequests,
    openedLinks: () => openedLinks,
    text: () => editor.source,
  };
}

test("the editor mounts in the test browser and holds the note", () => {
  const note = openNote("# Atlas\n\nSome prose.\n");
  assert.equal(note.text(), "# Atlas\n\nSome prose.\n");
});

test("Ctrl+S asks the host to save", () => {
  const note = openNote("# Atlas\n");
  assert.equal(note.saveRequests(), 0);

  note.press("s", { ctrl: true });
  assert.equal(note.saveRequests(), 1, "pressing save once asks once");
});

test("Ctrl+Z undoes what was typed and Ctrl+Y brings it back", () => {
  const note = openNote("# Atlas\n\n");
  note.caretTo(9);
  note.type("A sentence.");
  assert.equal(note.text(), "# Atlas\n\nA sentence.");

  note.press("z", { ctrl: true });
  assert.equal(note.text(), "# Atlas\n\n", "Ctrl+Z put the note back");

  note.press("y", { ctrl: true });
  assert.equal(note.text(), "# Atlas\n\nA sentence.", "Ctrl+Y brought it back");
});

test("Ctrl+Shift+Z also redoes, for readers who reach for that instead", () => {
  const note = openNote("# Atlas\n\n");
  note.caretTo(9);
  note.type("A sentence.");

  note.press("z", { ctrl: true });
  /*
   * Stated outright, because without it this test passes when nothing works at all: if the
   * undo never happened the text still reads as it did when typed, and the assertion below
   * cannot tell that from a redo that worked.
   */
  assert.equal(note.text(), "# Atlas\n\n", "precondition — Ctrl+Z undid the edit");

  note.press("Z", { ctrl: true, shift: true });
  assert.equal(note.text(), "# Atlas\n\nA sentence.");
});

test("undo survives the host confirming the note back", () => {
  const note = openNote("# Atlas\n\n");
  note.caretTo(9);
  note.type("| a | b |");

  // What happens after every keystroke: the host writes the file and confirms the text.
  note.editor.replaceSource("# Atlas\n\n| a | b |\n");

  note.press("z", { ctrl: true });
  assert.equal(
    note.text().includes("| a | b |"),
    false,
    "the reader's own edit is still undoable after a confirmation",
  );
});

test("Tab indents the line the caret is on", () => {
  const note = openNote("- one\n");
  note.caretTo(5);

  note.press("Tab");
  assert.equal(note.text().startsWith("  - one") || note.text().startsWith("\t- one"), true,
    `expected the line to be indented, got ${JSON.stringify(note.text())}`);
});

test("Enter at the end of a list item starts the next one", () => {
  const note = openNote("- one\n");
  note.caretTo(5);

  note.press("Enter");
  assert.equal(note.text(), "- one\n- \n",
    `expected the list to continue, got ${JSON.stringify(note.text())}`);
});

test("Enter on an empty list item ends the list instead of adding another bullet", () => {
  const note = openNote("- one\n- \n");
  note.caretTo(9);

  note.press("Enter");
  assert.equal(note.text().includes("- \n- "), false,
    `expected the empty item to end the list, got ${JSON.stringify(note.text())}`);
});

test("Ctrl+Enter follows the wiki link the caret is sitting in", () => {
  const note = openNote("See [[Project Atlas]] for more.\n");
  note.caretTo(12);

  note.press("Enter", { ctrl: true });
  assert.deepEqual(note.openedLinks(), ["Project Atlas"]);
});

test("Ctrl+Enter on ordinary prose opens nothing", () => {
  const note = openNote("Just a sentence.\n");
  note.caretTo(5);

  note.press("Enter", { ctrl: true });
  assert.deepEqual(note.openedLinks(), []);
});

test("a read-only note refuses the keys that would change it", () => {
  const note = openNote("- one\n");
  note.editor.setReadOnly(true);
  note.caretTo(5);

  note.press("Enter");
  note.press("Tab");
  assert.equal(note.text(), "- one\n", "nothing the keyboard did reached the note");
});

test("a note made editable again accepts those keys", () => {
  const note = openNote("- one\n");
  note.editor.setReadOnly(true);
  note.editor.setReadOnly(false);
  note.caretTo(5);

  note.press("Enter");
  assert.equal(note.text(), "- one\n- \n");
});

test("switching between Live and Markdown leaves the note's text alone", () => {
  const note = openNote("# Atlas\n\n- one\n");

  assert.equal(note.editor.toggleMode(), "markdown");
  assert.equal(note.text(), "# Atlas\n\n- one\n");
  assert.equal(note.editor.toggleMode(), "live");
  assert.equal(note.text(), "# Atlas\n\n- one\n");
});

test("undo still works after switching modes", () => {
  const note = openNote("# Atlas\n\n");
  note.caretTo(9);
  note.type("A sentence.");
  note.editor.toggleMode();

  note.press("z", { ctrl: true });
  assert.equal(note.text(), "# Atlas\n\n");
});

test("typing a note never asks the host to save on its own", () => {
  const note = openNote("# Atlas\n\n");
  note.caretTo(9);
  note.type("Some prose that is merely typed.");
  assert.equal(note.saveRequests(), 0, "only the save key asks for a save");
});
