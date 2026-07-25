import assert = require("node:assert/strict");
import { test } from "node:test";
import { EditorState } from "@codemirror/state";
import { applyTextPatch } from "../../src/application/textPatch";
import { createEditorDocument } from "../../src/webview/editor/editorDocument";
import { createEditorPatch } from "../../src/webview/editor/editorPatch";

test("derives one narrow raw patch from multiple CodeMirror changes", () => {
  const source = "one\ntwo";
  const state = EditorState.create({ doc: createEditorDocument(source) });
  const transaction = state.update({
    changes: [
      { from: 1, to: 2, insert: "N" },
      { from: 7, insert: "!" },
    ],
  });

  const result = createEditorPatch(
    transaction.changes,
    transaction.state.doc,
    source,
    "\n",
  );

  assert.ok(result !== undefined);
  assert.equal(result.patch.start, 1);
  assert.equal(result.patch.end, 7);
  assert.equal(applyTextPatch(source, result.patch), "oNe\ntwo!");
  assert.equal(result.source, "oNe\ntwo!");
});

test("maps CodeMirror offsets back to raw CRLF offsets", () => {
  const source = "one\r\ntwo\r\n";
  const state = EditorState.create({ doc: createEditorDocument(source) });
  const transaction = state.update({ changes: { from: 4, to: 7, insert: "second" } });

  const result = createEditorPatch(
    transaction.changes,
    transaction.state.doc,
    source,
    "\r\n",
  );

  assert.ok(result !== undefined);
  assert.deepEqual(result.patch, {
    start: 5,
    end: 8,
    source: "second",
    expectedSource: "two",
  });
  assert.equal(result.source, "one\r\nsecond\r\n");
});

test("preserves untouched mixed line endings around a narrow edit", () => {
  const source = "one\ntwo\r\nthree";
  const state = EditorState.create({ doc: createEditorDocument(source) });
  const transaction = state.update({ changes: { from: 8, to: 13, insert: "THREE" } });

  const result = createEditorPatch(
    transaction.changes,
    transaction.state.doc,
    source,
    "\n",
  );

  assert.ok(result !== undefined);
  assert.deepEqual(result.patch, {
    start: 9,
    end: 14,
    source: "THREE",
    expectedSource: "three",
  });
  assert.equal(result.source, "one\ntwo\r\nTHREE");
});

test("weaves untouched raw separators between disjoint editor changes", () => {
  const source = "one\ntwo\r\nthree";
  const state = EditorState.create({ doc: createEditorDocument(source) });
  const transaction = state.update({
    changes: [
      { from: 1, to: 2, insert: "N" },
      { from: 10, to: 11, insert: "R" },
    ],
  });

  const result = createEditorPatch(
    transaction.changes,
    transaction.state.doc,
    source,
    "\n",
  );

  assert.ok(result !== undefined);
  assert.equal(result.source, "oNe\ntwo\r\nthRee");
  assert.equal(applyTextPatch(source, result.patch), result.source);
});
