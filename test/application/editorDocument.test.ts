import assert = require("node:assert/strict");
import { test } from "node:test";
import {
  createEditorDocument,
  normalizeEditorInput,
  serializeEditorDocument,
} from "../../src/webview/editor/editorDocument";

test("normalizes multiline editor input and serializes with the note line ending", () => {
  const clipboard = normalizeEditorInput("first\nsecond\r\nthird\rfourth");
  const document = createEditorDocument(clipboard);

  assert.equal(document.lines, 4);
  assert.equal(
    serializeEditorDocument(document, "\r\n"),
    "first\r\nsecond\r\nthird\r\nfourth",
  );
});

test("creates logical CodeMirror lines from every supported Markdown line ending", () => {
  for (const source of ["one\ntwo", "one\r\ntwo", "one\rtwo"]) {
    assert.equal(createEditorDocument(source).lines, 2);
  }
});
