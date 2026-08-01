import assert = require("node:assert/strict");
import { test } from "node:test";
import type { NoteRecord } from "../../src/domain/models";
import {
  noteFolderChoices,
  rootRelativeNotePaths,
  validateNoteFolder,
} from "../../src/application/noteFolders";

function note(path: string): NoteRecord {
  return {
    uri: `file:///workspace/${path}`,
    path,
    fileName: path.split("/").at(-1) ?? path,
    title: path,
    modifiedAt: 0,
    content: "",
    aliases: [],
    headings: [],
    blockReferences: [],
    links: [],
    tasks: [],
    tags: [],
    blocks: [],
  };
}

test("the configured folder heads the list, so Enter accepts it", () => {
  const choices = noteFolderChoices(
    [note("journal/monday.md"), note("notes/idea.md")],
    "notes",
  );
  assert.equal(choices[0]?.path, "notes");
  assert.equal(choices[0]?.configured, true);
  assert.equal(choices.filter((choice) => choice.configured).length, 1);
});

test("folders are offered as deeply as notes actually live in them", () => {
  const choices = noteFolderChoices(
    [note("projects/visp/spec.md"), note("projects/other.md")],
    "notes",
  );
  const paths = choices.map((choice) => choice.path);
  assert.equal(paths.includes("projects/visp"), true);
  assert.equal(paths.includes("projects"), true);
});

test("each folder counts the notes directly in it", () => {
  const choices = noteFolderChoices(
    [note("journal/a.md"), note("journal/b.md"), note("journal/deep/c.md"), note("root.md")],
    "notes",
  );
  const byPath = new Map(choices.map((choice) => [choice.path, choice.count]));
  assert.equal(byPath.get("journal"), 2, "the nested note belongs to journal/deep");
  assert.equal(byPath.get("journal/deep"), 1);
  assert.equal(byPath.get(""), 1, "a note at the root");
  assert.equal(byPath.get("notes"), 0, "the configured folder is offered before it holds anything");
});

test("the workspace root is always offerable, and named", () => {
  const choices = noteFolderChoices([note("notes/a.md")], "notes");
  const root = choices.find((choice) => choice.path === "");
  assert.notEqual(root, undefined);
  assert.equal(root?.label, "Workspace root");
});

test("no folder is offered twice", () => {
  const choices = noteFolderChoices(
    [note("notes/a.md"), note("notes/b.md"), note("notes/c.md")],
    "notes",
  );
  assert.equal(new Set(choices.map((choice) => choice.path)).size, choices.length);
});

test("the list sorts predictably after the default", () => {
  const choices = noteFolderChoices(
    [note("zeta/a.md"), note("alpha/b.md"), note("Mid/c.md")],
    "notes",
  );
  assert.deepEqual(choices.slice(1).map((choice) => choice.path), ["", "alpha", "Mid", "zeta"]);
});

test("a misconfigured notesFolder still yields a usable list", () => {
  const choices = noteFolderChoices([note("notes/a.md")], "../escape");
  assert.equal(choices[0]?.path, "", "it falls back to the root rather than refusing to offer anything");
  assert.equal(choices[0]?.configured, true);
});

test("a typed folder is refused for the same reasons the setting is", () => {
  assert.equal(validateNoteFolder("journal"), undefined);
  assert.equal(validateNoteFolder("journal/2026"), undefined);
  assert.equal(validateNoteFolder(""), undefined, "the root is a folder");
  assert.notEqual(validateNoteFolder("../outside"), undefined);
  assert.notEqual(validateNoteFolder("/absolute"), undefined);
  assert.equal(
    validateNoteFolder("../outside")?.includes("vispNotes.notesFolder"),
    false,
    "the message should talk about the folder, not about a setting nobody is editing",
  );
});

/*
 * The bug these guard: in a multi-root workspace, `NoteRecord.path` leads with the root
 * folder's name. Building the folder list from it offered `rootB/journal` while creating under
 * root A, which would have manufactured an `A/rootB/journal/` that exists nowhere.
 */
test("paths are taken relative to the given root, from the URI", () => {
  const paths = rootRelativeNotePaths(
    [
      { uri: "file:///home/user/rootA/notes/a.md" },
      { uri: "file:///home/user/rootA/journal/deep/b.md" },
    ],
    "/home/user/rootA",
  );
  assert.deepEqual(paths.map((entry) => entry.path), ["notes/a.md", "journal/deep/b.md"]);
});

test("a note in another root is not offered here", () => {
  const paths = rootRelativeNotePaths(
    [
      { uri: "file:///home/user/rootA/notes/a.md" },
      { uri: "file:///home/user/rootB/journal/b.md" },
      { uri: "file:///home/user/rootAAA/tricky.md" },
    ],
    "/home/user/rootA",
  );
  assert.deepEqual(paths.map((entry) => entry.path), ["notes/a.md"]);
});

test("an encoded path decodes before it is compared", () => {
  const paths = rootRelativeNotePaths(
    [{ uri: "file:///home/user/my%20workspace/daily%20notes/a.md" }],
    "/home/user/my workspace",
  );
  assert.deepEqual(paths.map((entry) => entry.path), ["daily notes/a.md"]);
});

test("an unparseable URI is skipped rather than thrown on", () => {
  assert.deepEqual(rootRelativeNotePaths([{ uri: "not a uri" }], "/root"), []);
});
