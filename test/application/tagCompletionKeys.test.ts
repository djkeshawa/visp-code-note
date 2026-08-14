import assert = require("node:assert/strict");
import { test } from "node:test";
// Must come first: it installs the globals `@codemirror/view` reads while loading.
import { createHost } from "../support/domEnvironment";
import { CompletionContext } from "@codemirror/autocomplete";
import type { EditorState } from "@codemirror/state";
import { CodeMirrorEditor } from "../../src/webview/editor/codeMirrorEditor";
import { tagCompletions } from "../../src/webview/editor/tagCompletion";

/**
 * The `#` menu inside a real editor.
 *
 * The model and the guards are tested on their own. What only exists here is the wiring: that
 * the tag list the editor was handed is the one the menu offers, and that the row a reader
 * picks writes what it says it writes. A source can be perfectly correct and never installed.
 *
 * The source is asked at the caret rather than through the popup, because the tooltip appears
 * only after a debounce and a layout pass and jsdom performs neither. What is under test is
 * which rows the editor's own state produces, not when they are painted.
 */

const TAGS = ["project", "reading"];

interface OpenNote {
  readonly type: (text: string) => void;
  readonly caretTo: (offset: number) => void;
  readonly rows: () => readonly string[];
  readonly pick: (label: string) => void;
  readonly text: () => string;
}

function openNote(source: string, tags: readonly string[] = TAGS): OpenNote {
  const editor = new CodeMirrorEditor(createHost(), "test-nonce", source, {
    suggestions: () => [],
    workspaceTags: () => tags,
    unresolvedLinks: () => new Set<string>(),
    sourcePatched: () => undefined,
    saveRequested: () => undefined,
    openLink: () => undefined,
    openExternal: () => undefined,
    noteTitle: () => "Atlas",
  });
  const view = (editor as unknown as {
    view: { state: EditorState; dispatch: (spec: unknown) => void };
  }).view;

  const ask = () => tagCompletions(
    new CompletionContext(view.state, view.state.selection.main.head, false),
    tags,
  );

  return {
    type(text) {
      const { from, to } = view.state.selection.main;
      view.dispatch({
        changes: { from, to, insert: text },
        selection: { anchor: from + text.length },
        userEvent: "input.type",
      });
    },
    caretTo(offset) {
      view.dispatch({ selection: { anchor: offset } });
    },
    rows: () => (ask()?.options ?? []).map((option) => option.displayLabel ?? option.label),
    pick(label) {
      const result = ask();
      const option = result?.options.find(
        (entry) => (entry.displayLabel ?? entry.label) === label,
      );
      assert.notEqual(option, undefined, `no row labelled ${label}`);
      assert.equal(typeof option?.apply, "string", "a tag row writes a fixed string");
      view.dispatch({
        changes: { from: result?.from ?? 0, to: result?.to ?? 0, insert: String(option?.apply) },
        userEvent: "input.complete",
      });
    },
    text: () => editor.source,
  };
}

test("typing a hash mid-sentence offers the workspace's tags", () => {
  const note = openNote("Filed under \n");
  note.caretTo(12);
  note.type("#pro");

  assert.deepEqual(note.rows(), ["#project", "Create #pro"]);
});

test("picking an existing tag writes it into the sentence", () => {
  const note = openNote("Filed under \n");
  note.caretTo(12);
  note.type("#pro");

  note.pick("#project");
  assert.equal(note.text(), "Filed under #project\n");
});

test("picking the create row writes exactly what was typed, and nothing else", () => {
  const note = openNote("Filed under \n");
  note.caretTo(12);
  note.type("#quarterly");

  note.pick("Create #quarterly");
  assert.equal(note.text(), "Filed under #quarterly\n");
});

test("a workspace with no tags yet still offers to create the first one", () => {
  const note = openNote("Filed under \n", []);
  note.caretTo(12);
  note.type("#first");

  assert.deepEqual(note.rows(), ["Create #first"]);
});

test("the tag list the editor was handed is the list the menu offers", () => {
  /*
   * The seam this guards is the wire. Were the field dropped in transit the editor would hold
   * an empty list, and this menu would offer a lone Create row in a workspace full of tags —
   * which looks exactly like a workspace that has no tags.
   */
  const note = openNote("Filed under \n", ["alpha", "beta"]);
  note.caretTo(12);
  note.type("#");

  assert.deepEqual(note.rows(), ["#alpha", "#beta"]);
});
