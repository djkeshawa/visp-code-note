import assert = require("node:assert/strict");
import { test } from "node:test";
import type { IndexSnapshot, NoteRecord } from "../../src/domain/models";
import { parseMarkdown } from "../../src/markdown/parser";
import {
  buildNoteListing,
  emptyListingMessage,
  listingTitle,
} from "../../src/application/noteListing";

/*
 * The two lists the panel replaced a quick pick with. Both are derived from the index, so the
 * scenarios are workspaces: notes that link to each other, notes that link nowhere, and links
 * that land nowhere.
 */

function note(path: string, content: string): NoteRecord {
  const parsed = parseMarkdown(content);
  return {
    ...parsed,
    uri: `file:///workspace/${path}`,
    path,
    fileName: path.split("/").at(-1) ?? path,
    title: parsed.title?.trim() || (path.split("/").at(-1) ?? path).replace(/\.md$/, ""),
    modifiedAt: 0,
    content,
  };
}

/** Resolves each note's wiki links against the others, as the real index does. */
function workspace(...notes: readonly NoteRecord[]): IndexSnapshot {
  const byTitle = new Map(notes.map((entry) => [entry.title.toLocaleLowerCase(), entry]));
  return {
    notes,
    tasks: [],
    backlinks: [],
    links: notes.flatMap((source) => source.links.map((link) => {
      const target = byTitle.get(link.target.toLocaleLowerCase());
      return {
        sourceUri: source.uri,
        link,
        ...(target === undefined ? {} : { targetUri: target.uri }),
      };
    })),
    version: 1,
    indexedAt: 0,
  };
}

test("an orphan is a note nothing reaches and which reaches nothing", () => {
  const snapshot = workspace(
    note("a.md", "# A\n\nSee [[B]].\n"),
    note("b.md", "# B\n\nBody.\n"),
    note("lonely.md", "# Lonely\n\nNo links at all.\n"),
  );

  assert.deepEqual(
    buildNoteListing(snapshot, "orphans").map((row) => row.title),
    ["Lonely"],
  );
});

test("a note that links only to itself is still an orphan", () => {
  const snapshot = workspace(note("solo.md", "# Solo\n\nSee [[Solo]].\n"));
  assert.deepEqual(buildNoteListing(snapshot, "orphans").map((row) => row.title), ["Solo"]);
});

test("a broken link names the note it is in and the target that fails", () => {
  const snapshot = workspace(
    note("a.md", "# A\n\nSee [[Nowhere]].\n"),
    note("b.md", "# B\n\nBody.\n"),
  );

  const rows = buildNoteListing(snapshot, "broken");
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.title, "A");
  assert.equal(rows[0]?.path, "a.md");
  assert.equal(rows[0]?.detail, "[[Nowhere]]");
});

test("a broken link carries where it is, so the row can open at it", () => {
  const content = "# A\n\nFirst line.\n\nSee [[Nowhere]].\n";
  const snapshot = workspace(note("a.md", content));
  const [row] = buildNoteListing(snapshot, "broken");

  const start = row?.start;
  assert.equal(typeof start, "number");
  assert.equal(content.slice(start, (start ?? 0) + 11), "[[Nowhere]]");
  assert.equal(row?.line, 5, "one-based, as a gutter counts");
});

test("every broken link in a note gets its own row, in the order they appear", () => {
  const snapshot = workspace(note("a.md", "# A\n\n[[One]] then [[Two]].\n"));
  const rows = buildNoteListing(snapshot, "broken");
  assert.deepEqual(rows.map((row) => row.detail), ["[[One]]", "[[Two]]"]);
  assert.ok((rows[0]?.start ?? 0) < (rows[1]?.start ?? 0));
});

test("a link that resolves is not broken", () => {
  const snapshot = workspace(
    note("a.md", "# A\n\nSee [[B]].\n"),
    note("b.md", "# B\n\nBody.\n"),
  );
  assert.deepEqual(buildNoteListing(snapshot, "broken"), []);
});

test("rows sort by path, so a workspace reads in folder order", () => {
  const snapshot = workspace(
    note("zeta/z.md", "# Zed\n\nNo links.\n"),
    note("alpha/a.md", "# Alpha\n\nNo links.\n"),
    note("mid/m.md", "# Mid\n\nNo links.\n"),
  );
  assert.deepEqual(
    buildNoteListing(snapshot, "orphans").map((row) => row.path),
    ["alpha/a.md", "mid/m.md", "zeta/z.md"],
  );
});

test("an empty workspace lists nothing, and says why that is fine", () => {
  const snapshot = workspace();
  assert.deepEqual(buildNoteListing(snapshot, "orphans"), []);
  assert.deepEqual(buildNoteListing(snapshot, "broken"), []);
  assert.match(emptyListingMessage("orphans"), /connected/);
  assert.match(emptyListingMessage("broken"), /lands somewhere/);
  assert.equal(listingTitle("orphans"), "Orphan Notes");
  assert.equal(listingTitle("broken"), "Broken Links");
});
