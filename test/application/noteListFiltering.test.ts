import assert = require("node:assert/strict");
import { test } from "node:test";
import { filterNoteRows } from "../../src/webview/notes/listing";

const rows = [
  { uri: "file:///b.md", title: "Note 10", path: "projects/b.md", tags: ["design"], detail: "Missing target" },
  { uri: "file:///a.md", title: "Note 2", path: "archive/a.md", tags: ["design-system"] },
];

test("words can match titles, paths, details, and visible hashtags", () => {
  assert.deepEqual(filterNoteRows(rows, "#DESIGN projects target", "", "default"), [rows[0]]);
  assert.deepEqual(filterNoteRows(rows, "", "design", "default"), [rows[0]]);
  assert.deepEqual(filterNoteRows(rows, "missing archive", "", "default"), []);
});

test("natural title sorting does not mutate the host's default order", () => {
  assert.deepEqual(filterNoteRows(rows, "", "", "title"), [rows[1], rows[0]]);
  assert.deepEqual(filterNoteRows(rows, "", "", "path"), [rows[1], rows[0]]);
  assert.deepEqual(filterNoteRows(rows, "", "", "default"), rows);
  assert.equal(rows[0]?.title, "Note 10");
});
