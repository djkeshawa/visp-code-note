import assert = require("node:assert/strict");
import { afterEach, test } from "node:test";
import { createHost } from "../support/domEnvironment";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { undo } from "@codemirror/commands";
import { CodeMirrorEditor } from "../../src/webview/editor/codeMirrorEditor";

const editors: CodeMirrorEditor[] = [];
afterEach(() => { for (const editor of editors.splice(0)) editor.destroy(); });

function open(source: string) {
  const host = createHost();
  const editor = new CodeMirrorEditor(host, "test-nonce", source, {
    suggestions: () => [], workspaceTags: () => [], unresolvedLinks: () => new Set(),
    sourcePatched: () => {}, saveRequested: () => {}, openLink: () => {},
    openExternal: () => {}, noteTitle: () => "Note",
  });
  editors.push(editor);
  const view = EditorView.findFromDOM(host.querySelector<HTMLElement>(".cm-editor")!);
  assert.ok(view);
  return { editor, view };
}

test("a host edit before the caret keeps it beside the same text", () => {
  const { editor, view } = open("First\nSecond paragraph");
  view.dispatch({ selection: { anchor: 12 } });
  editor.replaceSource("Title\nFirst\nSecond paragraph");
  assert.equal(view.state.selection.main.head, 18);
});

test("a host refresh preserves all selections and their direction", () => {
  const { editor, view } = open("First\nSecond paragraph");
  view.dispatch({ selection: EditorSelection.create([
    EditorSelection.range(5, 1), EditorSelection.range(6, 12),
  ], 1) });
  editor.replaceSource("Title\nFirst\nSecond paragraph");
  assert.deepEqual(view.state.selection.ranges.map(({ anchor, head }) => [anchor, head]), [[11, 7], [12, 18]]);
  assert.equal(view.state.selection.mainIndex, 1);
});

test("changing line endings on save preserves selection and undo history", () => {
  const { editor, view } = open("# Note\n\n");
  view.dispatch({ changes: { from: 8, insert: "Keep this" }, selection: { anchor: 17 }, userEvent: "input.type" });
  view.dispatch({ selection: { anchor: 17, head: 8 } });
  editor.replaceSource("# Note\r\n\r\nKeep this");
  assert.equal(view.state.selection.main.anchor, 17);
  assert.equal(view.state.selection.main.head, 8);
  assert.equal(undo(view), true, "line-ending normalization erased the undo history");
  assert.equal(editor.source, "# Note\r\n\r\n");
});

test("undo still removes typed text after the host converts LF to CRLF", () => {
  const { editor, view } = open("# Note\n\n");
  view.dispatch({ changes: { from: 8, insert: "Keep this" }, selection: { anchor: 17 }, userEvent: "input.type" });
  editor.replaceSource("# Note\r\n\r\nKeep this");
  assert.equal(undo(view), true, "line-ending normalization erased the undo history");
  assert.equal(editor.source, "# Note\r\n\r\n");
});
