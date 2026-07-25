import assert = require("node:assert/strict");
import { test } from "node:test";
import {
  detectLineSeparator,
  editorOffsetToRawOffset,
  rawOffsetToEditorOffset,
} from "../../src/webview/editor/offsetMapping";

test("detects LF, CRLF, and legacy CR line separators", () => {
  assert.equal(detectLineSeparator("one\ntwo"), "\n");
  assert.equal(detectLineSeparator("one\r\ntwo"), "\r\n");
  assert.equal(detectLineSeparator("one\rtwo"), "\r");
  assert.equal(detectLineSeparator("one line"), "\n");
});

test("maps raw CRLF offsets to CodeMirror offsets and back", () => {
  const source = "a\r\n😀\r\nz";
  const rawBoundaries = [0, 1, 3, 5, 7, 8];
  const editorBoundaries = [0, 1, 2, 4, 5, 6];
  assert.deepEqual(
    rawBoundaries.map((offset) => rawOffsetToEditorOffset(source, offset)),
    editorBoundaries,
  );
  assert.deepEqual(
    editorBoundaries.map((offset) => editorOffsetToRawOffset(source, offset)),
    rawBoundaries,
  );
});

test("maps an offset inside CRLF forward to its atomic editor boundary", () => {
  const source = "a\r\nb";
  assert.equal(rawOffsetToEditorOffset(source, 2), 2);
  assert.equal(editorOffsetToRawOffset(source, 2), 3);
});

test("keeps LF and CR offsets as raw UTF-16 offsets", () => {
  const lf = "a\n😀\nz";
  const cr = "a\r😀\rz";
  for (const offset of [0, 1, 2, 4, 5, 6]) {
    assert.equal(rawOffsetToEditorOffset(lf, offset), offset);
    assert.equal(editorOffsetToRawOffset(lf, offset), offset);
    assert.equal(rawOffsetToEditorOffset(cr, offset), offset);
    assert.equal(editorOffsetToRawOffset(cr, offset), offset);
  }
});

test("treats every CRLF in mixed input as atomic and clamps offsets", () => {
  const mixed = "a\r\nb\nc";
  assert.equal(rawOffsetToEditorOffset(mixed, mixed.length), mixed.length - 1);
  assert.equal(editorOffsetToRawOffset(mixed, 1_000), mixed.length);
  assert.equal(rawOffsetToEditorOffset(mixed, -10), 0);
  assert.equal(rawOffsetToEditorOffset(mixed, Number.POSITIVE_INFINITY), mixed.length - 1);
});
