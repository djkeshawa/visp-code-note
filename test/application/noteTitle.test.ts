import assert = require("node:assert/strict");
import { test } from "node:test";
import { conflictingNote, validateNoteTitle } from "../../src/application/noteTitle";
import { titleToFileName } from "../../src/domain/normalization";
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

test("a title that names a Windows device still produces a usable file name", () => {
  // These are device names on Windows, refused by the file system whatever extension follows,
  // so a note titled "con" or "aux" failed to create with an error about nothing in particular.
  for (const reserved of ["con", "CON", "nul", "aux", "prn", "com1", "lpt9"]) {
    assert.equal(titleToFileName(reserved), `${reserved}_.md`, reserved);
  }
  // Only the exact names are reserved; words that merely begin with one are untouched.
  assert.equal(titleToFileName("console"), "console.md");
  assert.equal(titleToFileName("con game"), "con game.md");
  assert.equal(titleToFileName("Normal Note"), "Normal Note.md");
});
