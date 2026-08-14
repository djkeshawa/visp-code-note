import assert = require("node:assert/strict");
import { test } from "node:test";
// Must come first: it draws the panel's markup and installs the host stub the panel loads into.
import "../support/freshWorkspacePanel";
import "../../src/webview/workspace";
import {
  posted,
  publish,
  press,
  rowDepth,
  rowLabels,
  savedState,
  typeFilter,
} from "../support/workspacePanelDom";
import { panelState } from "../support/workspacePanelState";

/*
 * The nested vault the panel used to collapse into one row. `projects` held everything, and
 * opening it listed every note beneath it flat, in path order, with nothing to collapse and no
 * sub-heading — then cut the list off and told the reader to narrow the search instead.
 */
const VAULT = [
  "projects/2026/alpha/index.md",
  "projects/2026/alpha/notes.md",
  "projects/2026/beta/index.md",
  "projects/2025/retro.md",
  "journal/monday.md",
  "inbox.md",
];

function notesSection(): readonly string[] {
  return rowLabels("workspace-notes");
}

function row(label: string): HTMLElement {
  const found = Array.from(
    document.querySelectorAll<HTMLElement>("#workspace-notes .workspace-row"),
  ).find((candidate) => (candidate.textContent ?? "").trim().startsWith(label));
  if (found === undefined) {
    throw new Error(`no row starting "${label}" among ${notesSection().join(", ")}`);
  }
  return found;
}

function folderRows(open: boolean): readonly HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(
    `#workspace-notes .workspace-row[aria-expanded="${String(open)}"]`,
  ));
}

/**
 * A panel showing the vault with every folder shut, whatever the last test left open.
 *
 * Everything is opened before it is closed, because closing a folder hides its open children
 * without forgetting them — the way an explorer does — so a folder shut from the outside in
 * leaves expansion state that nothing on screen can reach.
 */
async function freshVault(): Promise<void> {
  await typeFilter("");
  publish(panelState(VAULT));
  for (let guard = 0; guard < 20 && folderRows(false).length > 0; guard += 1) {
    folderRows(false)[0]?.click();
  }
  for (let guard = 0; guard < 20 && folderRows(true).length > 0; guard += 1) {
    // Deepest first, so a parent never hides a child that is still open.
    folderRows(true).at(-1)?.click();
  }
  posted.length = 0;
}

test("a closed vault shows its top folders and the notes at the root", async () => {
  await freshVault();

  assert.deepEqual(notesSection(), ["journal1", "projects4", "Inbox"]);
});

/*
 * The whole complaint. Opening `projects` used to spill every note beneath it into the list;
 * it now shows the two years inside it — four rows rather than everything, and in the vault
 * this was reported from, four rather than 1,800.
 */
test("opening a folder shows what is inside it, not everything beneath it", async () => {
  await freshVault();
  row("projects").click();

  assert.deepEqual(notesSection(), ["journal1", "projects4", "20251", "20263", "Inbox"]);
});

test("a folder opened inside a folder nests again, and its notes sit deeper still", async () => {
  await freshVault();
  row("projects").click();
  row("2026").click();
  row("beta").click();

  assert.deepEqual(notesSection(), [
    "journal1",
    "projects4",
    "20251",
    "20263",
    "alpha2",
    "beta1",
    "Indexbeta",
    "Inbox",
  ]);
  assert.equal(rowDepth(row("projects")), 0);
  assert.equal(rowDepth(row("2026")), 1);
  assert.equal(rowDepth(row("beta")), 2);
  assert.equal(rowDepth(row("Index")), 3);
});

test("a folder closes again, taking its whole subtree with it", async () => {
  await freshVault();
  row("projects").click();
  row("2026").click();
  assert.ok(notesSection().includes("alpha2"));

  row("projects").click();
  assert.deepEqual(notesSection(), ["journal1", "projects4", "Inbox"]);
});

test("a closed folder still says how many notes are anywhere beneath it", async () => {
  await freshVault();

  assert.equal(row("projects").textContent?.trim(), "projects4");
});

/*
 * The keys are only strings, so a nested path should need no new persistence — but nothing had
 * ever put one in, so the claim was worth pressing rather than believing.
 */
test("opening a nested folder stores its path for the next reload", async () => {
  await freshVault();
  row("projects").click();
  row("2026").click();

  assert.deepEqual([...savedState?.expanded ?? []].sort(), [
    "folder:projects",
    "folder:projects/2026",
    "view:due",
  ]);
});

/* A folder's own notes sit under it, before the next folder along, as an explorer lists them. */
test("a note whose title is its own says nothing but its title", async () => {
  await freshVault();
  row("journal").click();

  assert.deepEqual(notesSection(), ["journal1", "Monday", "projects4", "Inbox"]);
});

/* The tree convention the Due Today row already uses: right opens, left closes. */
test("the arrow keys open and close a folder", async () => {
  await freshVault();
  press(row("projects"), "ArrowRight");
  assert.ok(notesSection().includes("20263"));

  press(row("projects"), "ArrowLeft");
  assert.equal(notesSection().includes("20263"), false);
});

test("the panel asks the host to open the note a row names", async () => {
  await freshVault();
  row("Inbox").click();

  assert.deepEqual(posted, [{ type: "workspace/openNote", uri: "file:///vault/inbox.md" }]);
});

/*
 * The panel is where the honest wording has to reach a reader before they click. "Recent
 * Notes" reads as when you wrote them, and the list is ordered by when the file last changed.
 */
test("the Recent Notes row says what it is ordered by before it is opened", async () => {
  await freshVault();
  const row = Array.from(document.querySelectorAll<HTMLElement>("#workspace-views .workspace-row"))
    .find((candidate) => (candidate.textContent ?? "").includes("Recent Notes"));

  assert.notEqual(row, undefined, "the Recent Notes view is missing from the panel");
  assert.match(row?.title ?? "", /not the same as when you wrote it/i);
});

test("opening it asks the host for the recent listing", async () => {
  await freshVault();
  Array.from(document.querySelectorAll<HTMLElement>("#workspace-views .workspace-row"))
    .find((candidate) => (candidate.textContent ?? "").includes("Recent Notes"))
    ?.click();

  assert.deepEqual(posted, [{ type: "workspace/openView", id: "recent" }]);
});

/*
 * Four `index.md` files under four projects drew four identical rows, and hovering each one in
 * turn was the only way to tell them apart. Filtering is where they meet, because filtering is
 * the one place the tree is flattened.
 */
test("rows sharing a title say which folder each one is in", async () => {
  await freshVault();
  await typeFilter("index");

  assert.deepEqual(notesSection(), ["Indexalpha", "Indexbeta"]);
  await typeFilter("");
});
