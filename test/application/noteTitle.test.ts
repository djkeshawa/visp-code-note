import assert = require("node:assert/strict");
import { test } from "node:test";
import { conflictingNote, validateNoteTitle } from "../../src/application/noteTitle";
import type { NoteRecord } from "../../src/domain/models";

test("accepts encodable wiki punctuation but rejects multiline titles", () => {
  assert.equal(validateNoteTitle("Project #1"), undefined);
  assert.equal(validateNoteTitle("Alias | target"), undefined);
  assert.match(validateNoteTitle("two\nlines") ?? "", /one line/);
  assert.equal(validateNoteTitle("A safe title"), undefined);
  assert.equal(validateNoteTitle("100% Complete"), undefined);
});

test("detects title and alias conflicts while excluding the renamed note", () => {
  const note = {
    uri: "file:///one.md",
    title: "One",
    aliases: ["First"],
  } as unknown as NoteRecord;
  assert.equal(conflictingNote([note], "first")?.uri, note.uri);
  assert.equal(conflictingNote([note], "One", note.uri), undefined);
});
