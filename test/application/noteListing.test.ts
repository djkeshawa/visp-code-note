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
 * The three lists the panel replaced a quick pick with. All are derived from the index, so the
 * scenarios are workspaces: notes that link to each other, notes that link nowhere, links that
 * land nowhere, and notes sharing a tag.
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
    buildNoteListing(snapshot, { kind: "orphans" }).map((row) => row.title),
    ["Lonely"],
  );
});

test("a note that links only to itself is still an orphan", () => {
  const snapshot = workspace(note("solo.md", "# Solo\n\nSee [[Solo]].\n"));
  assert.deepEqual(buildNoteListing(snapshot, { kind: "orphans" }).map((row) => row.title), ["Solo"]);
});

test("a broken link names the note it is in and the target that fails", () => {
  const snapshot = workspace(
    note("a.md", "# A\n\nSee [[Nowhere]].\n"),
    note("b.md", "# B\n\nBody.\n"),
  );

  const rows = buildNoteListing(snapshot, { kind: "broken" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.title, "A");
  assert.equal(rows[0]?.path, "a.md");
  assert.equal(rows[0]?.detail, "[[Nowhere]]");
});

test("a broken link carries where it is, so the row can open at it", () => {
  const content = "# A\n\nFirst line.\n\nSee [[Nowhere]].\n";
  const snapshot = workspace(note("a.md", content));
  const [row] = buildNoteListing(snapshot, { kind: "broken" });

  const start = row?.start;
  assert.equal(typeof start, "number");
  assert.equal(content.slice(start, (start ?? 0) + 11), "[[Nowhere]]");
  assert.equal(row?.line, 5, "one-based, as a gutter counts");
});

test("every broken link in a note gets its own row, in the order they appear", () => {
  const snapshot = workspace(note("a.md", "# A\n\n[[One]] then [[Two]].\n"));
  const rows = buildNoteListing(snapshot, { kind: "broken" });
  assert.deepEqual(rows.map((row) => row.detail), ["[[One]]", "[[Two]]"]);
  assert.ok((rows[0]?.start ?? 0) < (rows[1]?.start ?? 0));
});

test("a link that resolves is not broken", () => {
  const snapshot = workspace(
    note("a.md", "# A\n\nSee [[B]].\n"),
    note("b.md", "# B\n\nBody.\n"),
  );
  assert.deepEqual(buildNoteListing(snapshot, { kind: "broken" }), []);
});

test("rows sort by path, so a workspace reads in folder order", () => {
  const snapshot = workspace(
    note("zeta/z.md", "# Zed\n\nNo links.\n"),
    note("alpha/a.md", "# Alpha\n\nNo links.\n"),
    note("mid/m.md", "# Mid\n\nNo links.\n"),
  );
  assert.deepEqual(
    buildNoteListing(snapshot, { kind: "orphans" }).map((row) => row.path),
    ["alpha/a.md", "mid/m.md", "zeta/z.md"],
  );
});

test("an empty workspace lists nothing, and says why that is fine", () => {
  const snapshot = workspace();
  assert.deepEqual(buildNoteListing(snapshot, { kind: "orphans" }), []);
  assert.deepEqual(buildNoteListing(snapshot, { kind: "broken" }), []);
  assert.match(emptyListingMessage({ kind: "orphans" }), /connected/);
  assert.match(emptyListingMessage({ kind: "broken" }), /lands somewhere/);
  assert.equal(listingTitle({ kind: "orphans" }), "Orphan Notes");
  assert.equal(listingTitle({ kind: "broken" }), "Broken Links");
});

/*
 * Clicking a tag chip used to run the workspace search pre-filled with the tag: a dropdown over
 * the palette, mixing notes, tasks and text matches. A tag is a collection, so it gets the list
 * every other collection here gets.
 */
test("a tag lists the notes carrying it, in path order", () => {
  const snapshot = workspace(
    note("zeta.md", "---\ntags: [ops]\n---\n# Zeta\n"),
    note("alpha.md", "---\ntags: [ops]\n---\n# Alpha\n"),
    note("other.md", "---\ntags: [design]\n---\n# Other\n"),
  );

  assert.deepEqual(
    buildNoteListing(snapshot, { kind: "tag", tag: "ops" }).map((row) => row.path),
    ["alpha.md", "zeta.md"],
  );
});

test("a tag matches however it was capitalised, and wherever it was written", () => {
  const snapshot = workspace(
    note("front.md", "---\ntags: [Ops]\n---\n# Front\n"),
    note("inline.md", "# Inline\n\nTagged #ops in the prose.\n"),
  );

  assert.deepEqual(
    buildNoteListing(snapshot, { kind: "tag", tag: "OPS" }).map((row) => row.title).sort(),
    ["Front", "Inline"],
  );
});

/*
 * Names rather than one joined string: each is drawn in its own hue, and a tag's hue is derived
 * from its name, so the panel needs them apart.
 */
test("a tag row carries the note's other tags, which is how you tell them apart", () => {
  const snapshot = workspace(
    note("both.md", "---\ntags: [ops, release, docs]\n---\n# Both\n"),
    note("only.md", "---\ntags: [ops]\n---\n# Only\n"),
  );
  const rows = buildNoteListing(snapshot, { kind: "tag", tag: "ops" });

  assert.deepEqual(rows.find((row) => row.title === "Both")?.tags, ["release", "docs"]);
  assert.equal(
    rows.find((row) => row.title === "Only")?.tags,
    undefined,
    "a note with nothing else to say carries no tags at all",
  );
  assert.equal(
    rows.every((row) => row.detail === undefined),
    true,
    "the joined-string detail belongs to a broken link, not to a tag",
  );
});

test("a tag nothing carries lists nothing, and says which tag", () => {
  const snapshot = workspace(note("a.md", "---\ntags: [ops]\n---\n# A\n"));
  assert.deepEqual(buildNoteListing(snapshot, { kind: "tag", tag: "missing" }), []);
  assert.equal(emptyListingMessage({ kind: "tag", tag: "missing" }), "No note carries #missing.");
  assert.equal(listingTitle({ kind: "tag", tag: "ops" }), "#ops");
});
