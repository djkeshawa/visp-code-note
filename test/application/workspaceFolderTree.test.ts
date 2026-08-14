import assert = require("node:assert/strict");
import { test } from "node:test";
import { folderTreeRows, workspaceTreeRows } from "../../src/application/workspaceFolderTree";
import type { WorkspaceFolderNode } from "../../src/application/workspaceFolderTree";

/*
 * The complaint this file exists for: a vault organised `projects/2026/alpha/notes.md` had one
 * `projects` row counting 1,800 notes, and opening it listed all 1,800 in one flat run.
 */

const NESTED = [
  { path: "projects/2026/alpha/notes.md" },
  { path: "projects/2026/alpha/index.md" },
  { path: "projects/2026/beta/index.md" },
  { path: "projects/2025/old.md" },
  { path: "journal/monday.md" },
  { path: "inbox.md" },
];

function paths(folders: readonly WorkspaceFolderNode[]): readonly string[] {
  return folders.map((folder) => folder.path);
}

test("a folder exists at every depth, not only at the top", () => {
  assert.deepEqual(paths(folderTreeRows(NESTED)), [
    "journal",
    "projects",
    "projects/2025",
    "projects/2026",
    "projects/2026/alpha",
    "projects/2026/beta",
  ]);
});

test("a folder counts everything beneath it, so a closed folder still says what it holds", () => {
  const byPath = new Map(folderTreeRows(NESTED).map((folder) => [folder.path, folder]));

  assert.equal(byPath.get("projects")?.count, 4);
  assert.equal(byPath.get("projects/2026")?.count, 3);
  assert.equal(byPath.get("projects/2026/beta")?.count, 1);
});

test("a row shows its own name and says where it sits, so indentation can do the rest", () => {
  const alpha = folderTreeRows(NESTED).find((folder) => folder.path === "projects/2026/alpha");

  assert.equal(alpha?.label, "alpha");
  assert.equal(alpha?.depth, 2);
  assert.equal(alpha?.parent, "projects/2026");
});

test("the top of the tree has no parent to point at", () => {
  const journal = folderTreeRows(NESTED).find((folder) => folder.path === "journal");

  assert.equal(journal?.depth, 0);
  assert.equal(journal?.parent, undefined);
});

/*
 * A folder holding nothing directly is still a place you have to be able to open — without a
 * row for `a`, the notes under `a/b/c` are unreachable by browsing at all.
 */
test("a folder that only holds other folders is still a row", () => {
  assert.deepEqual(paths(folderTreeRows([{ path: "a/b/c/note.md" }])), ["a", "a/b", "a/b/c"]);
});

/*
 * `a-b` and `a/b` compare on `-` against `/` when whole paths are compared, which drops an
 * unrelated folder into the middle of a subtree and breaks the indentation on screen.
 */
test("a folder sorts directly above its own children, whatever the neighbours are called", () => {
  const rows = folderTreeRows([
    { path: "a/b/deep.md" },
    { path: "a-later/note.md" },
    { path: "a/note.md" },
  ]);

  assert.deepEqual(paths(rows), ["a", "a/b", "a-later"]);
});

const TREE = folderTreeRows(NESTED);
/* In the order the index hands them over, which is by path. */
const NOTES = NESTED
  .map((note) => ({ folder: note.path.split("/").slice(0, -1).join("/"), path: note.path }))
  .sort((left, right) => left.path.localeCompare(right.path));

/** Every row the panel would draw, indented by the depth it would draw it at. */
function drawn(expanded: readonly string[]): readonly string[] {
  const open = new Set(expanded);
  return workspaceTreeRows(TREE, NOTES, (path) => open.has(path)).map((row) =>
    " ".repeat(row.depth) + (row.kind === "folder" ? `${row.folder.path}/` : row.note.path));
}

test("a closed tree draws one row per top folder, and the notes at the root", () => {
  assert.deepEqual(drawn([]), ["journal/", "projects/", "inbox.md"]);
});

/*
 * The whole point: opening `projects` shows what is inside `projects`, not the 1,800 notes
 * somewhere beneath it.
 */
test("opening a folder shows its children, not its whole subtree", () => {
  assert.deepEqual(drawn(["projects"]), [
    "journal/",
    "projects/",
    " projects/2025/",
    " projects/2026/",
    "inbox.md",
  ]);
});

test("subfolders come before a folder's own notes, the way an explorer lists them", () => {
  assert.deepEqual(drawn(["projects", "projects/2026"]), [
    "journal/",
    "projects/",
    " projects/2025/",
    " projects/2026/",
    "  projects/2026/alpha/",
    "  projects/2026/beta/",
    "inbox.md",
  ]);
  assert.deepEqual(drawn(["projects", "projects/2026", "projects/2026/alpha"]), [
    "journal/",
    "projects/",
    " projects/2025/",
    " projects/2026/",
    "  projects/2026/alpha/",
    "   projects/2026/alpha/index.md",
    "   projects/2026/alpha/notes.md",
    "  projects/2026/beta/",
    "inbox.md",
  ]);
});

test("a folder inside a closed folder is not drawn at all", () => {
  assert.equal(drawn(["projects/2026"]).some((row) => row.includes("alpha")), false);
});
