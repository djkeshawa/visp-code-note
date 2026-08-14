import assert = require("node:assert/strict");
import { test } from "node:test";
// Must come first: it installs the globals `@codemirror/view` reads while loading.
import { createHost } from "../support/domEnvironment";
import { EDITOR_BODY } from "../../src/ui/pageBodies";
import { CodeMirrorEditor } from "../../src/webview/editor/codeMirrorEditor";
import { wordCountLabel } from "../../src/webview/editor/wordCount";

/**
 * How long the note is, asked of the editor holding it.
 *
 * The tasks and notes views both end in a footer stating what they hold; the surface holding
 * the whole document was the one that would not say. The count has to come from the live
 * document rather than the last text the host acknowledged, or it lags every keystroke.
 */

const NOTE = [
  "---",
  "title: Atlas",
  "---",
  "# Atlas",
  "",
  "One two three four.",
].join("\n");

function openNote(source: string): CodeMirrorEditor {
  return new CodeMirrorEditor(createHost(), "test-nonce", source, {
    suggestions: () => [],
    workspaceTags: () => [],
    unresolvedLinks: () => new Set<string>(),
    sourcePatched: () => undefined,
    saveRequested: () => undefined,
    openLink: () => undefined,
    openExternal: () => undefined,
    noteTitle: () => "Atlas",
  });
}

test("the page has somewhere to write the count", () => {
  assert.equal(
    EDITOR_BODY.includes('id="editor-word-count"'),
    true,
    "editor.ts requires this element and throws on load without it",
  );
});

test("the count is of the note's prose, not its source", () => {
  const editor = openNote(NOTE);
  assert.deepEqual(editor.wordCounts(), { total: 5 }, "Atlas, one, two, three, four");
});

test("what has been typed counts before the host has acknowledged it", () => {
  const editor = openNote(NOTE);
  const view = (editor as unknown as {
    view: { dispatch: (spec: unknown) => void; state: { doc: { length: number } } };
  }).view;
  view.dispatch({ changes: { from: view.state.doc.length, insert: " five six" } });

  assert.equal(editor.wordCounts().total, 7, "the draft counts, not the last synced text");
});

test("a selection is counted beside the whole", () => {
  const editor = openNote(NOTE);
  const view = (editor as unknown as { view: { dispatch: (spec: unknown) => void } }).view;
  const from = NOTE.indexOf("One two three four.");
  view.dispatch({ selection: { anchor: from, head: from + "One two".length } });

  const counts = editor.wordCounts();
  assert.deepEqual(counts, { total: 5, selected: 2 });
  assert.equal(wordCountLabel(counts), "2 of 5 words selected");
});
