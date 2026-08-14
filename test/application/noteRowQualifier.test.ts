import assert = require("node:assert/strict");
import { test } from "node:test";
import { noteRowQualifiers } from "../../src/application/noteRowQualifier";

function note(path: string, title: string): { uri: string; title: string; path: string } {
  return { uri: `file:///vault/${path}`, title, path };
}

test("a note whose title is its own says nothing extra", () => {
  const qualifiers = noteRowQualifiers([
    note("projects/alpha/notes.md", "Alpha Notes"),
    note("projects/beta/index.md", "Index"),
  ]);

  assert.equal(qualifiers.get("file:///vault/projects/alpha/notes.md"), undefined);
});

/*
 * The complaint: four `index.md` files under four projects drew four identical rows, and the
 * only way to tell them apart was to hover each one.
 */
test("notes sharing a title are told apart by the folder holding them", () => {
  const qualifiers = noteRowQualifiers([
    note("projects/alpha/index.md", "Index"),
    note("projects/beta/index.md", "Index"),
    note("projects/gamma/index.md", "Index"),
  ]);

  assert.equal(qualifiers.get("file:///vault/projects/alpha/index.md"), "alpha");
  assert.equal(qualifiers.get("file:///vault/projects/beta/index.md"), "beta");
  assert.equal(qualifiers.get("file:///vault/projects/gamma/index.md"), "gamma");
});

/* One segment is not always enough — two `2026/alpha` and `2025/alpha` are still one word. */
test("the qualifier grows until it actually separates the rows", () => {
  const qualifiers = noteRowQualifiers([
    note("projects/2026/alpha/index.md", "Index"),
    note("projects/2025/alpha/index.md", "Index"),
    note("journal/beta/index.md", "Index"),
  ]);

  assert.equal(qualifiers.get("file:///vault/projects/2026/alpha/index.md"), "2026/alpha");
  assert.equal(qualifiers.get("file:///vault/projects/2025/alpha/index.md"), "2025/alpha");
  // One word is enough for this one, so it is not lengthened to match its neighbours.
  assert.equal(qualifiers.get("file:///vault/journal/beta/index.md"), "beta");
});

/* Same title, same folder: nothing about the folder can separate them, but the file name can. */
test("two notes titled the same in one folder fall back to their file names", () => {
  const qualifiers = noteRowQualifiers([
    note("journal/monday.md", "Journal"),
    note("journal/tuesday.md", "Journal"),
  ]);

  assert.equal(qualifiers.get("file:///vault/journal/monday.md"), "monday.md");
  assert.equal(qualifiers.get("file:///vault/journal/tuesday.md"), "tuesday.md");
});

test("a note at the workspace root has no folder to name, so it names the file", () => {
  const qualifiers = noteRowQualifiers([
    note("index.md", "Index"),
    note("projects/index.md", "Index"),
  ]);

  assert.equal(qualifiers.get("file:///vault/index.md"), "index.md");
  assert.equal(qualifiers.get("file:///vault/projects/index.md"), "projects");
});

test("titles collide regardless of case, as a reader reading the list would see them", () => {
  const qualifiers = noteRowQualifiers([
    note("a/index.md", "Index"),
    note("b/index.md", "INDEX"),
  ]);

  assert.equal(qualifiers.get("file:///vault/a/index.md"), "a");
  assert.equal(qualifiers.get("file:///vault/b/index.md"), "b");
});
