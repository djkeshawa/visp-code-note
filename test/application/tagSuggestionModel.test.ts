import assert = require("node:assert/strict");
import { test } from "node:test";
import { findTagQuery, rankTagSuggestions } from "../../src/webview/editor/tagSuggestionModel";

/**
 * Which `#` opens a menu, and what the menu says.
 *
 * The ranking is the reason the feature exists rather than a detail of it: a writer typing a
 * name one letter off an existing tag has to be shown the existing one, or the workspace grows
 * a second hue and a second graph node for the same idea.
 */

const TAGS = ["project", "projects-archive", "reading", "work/admin", "Atlas"];

function names(tags: readonly string[], query: string): readonly string[] {
  return rankTagSuggestions(tags, query).map(
    (suggestion) => (suggestion.create ? `Create #${suggestion.name}` : suggestion.name),
  );
}

test("a hash at the start of a line opens a tag", () => {
  assert.deepEqual(findTagQuery("#pro"), { start: 0, query: "pro", opensLine: true });
});

test("a hash after a space mid-sentence opens a tag", () => {
  assert.deepEqual(findTagQuery("filed under #pro"), {
    start: 12,
    query: "pro",
    opensLine: false,
  });
});

test("a hash bolted onto a word is not a tag", () => {
  // `C#` is a language, not a tag, and the parser would not read one there either.
  assert.equal(findTagQuery("written in C#"), undefined);
});

test("a second hash is a heading level, not a tag", () => {
  assert.equal(findTagQuery("##"), undefined);
});

test("a hash followed by a space has been abandoned", () => {
  assert.equal(findTagQuery("# Heading"), undefined);
});

test("an opening bracket counts as a boundary, as the parser says it does", () => {
  assert.deepEqual(findTagQuery("(#pro"), { start: 1, query: "pro", opensLine: false });
});

test("a bare hash is a tag with nothing typed yet", () => {
  assert.deepEqual(findTagQuery("see #"), { start: 4, query: "", opensLine: false });
});

test("an empty query offers the whole vocabulary, most used first", () => {
  assert.deepEqual(names(TAGS, ""), TAGS, "the host already sorted these by usage");
});

test("a prefix match beats a match in the middle of a name", () => {
  assert.deepEqual(
    names(["unproject", "project"], "pro"),
    ["project", "unproject", "Create #pro"],
  );
});

test("a nested tag answers to either of its segments", () => {
  assert.deepEqual(names(TAGS, "admin"), ["work/admin", "Create #admin"]);
});

test("matching is case-insensitive both ways round", () => {
  assert.deepEqual(names(TAGS, "atl"), ["Atlas", "Create #atl"]);
  assert.deepEqual(names(["atlas"], "ATL"), ["atlas", "Create #ATL"]);
});

test("a near miss shows the existing tag before it offers to coin a new one", () => {
  /*
   * The case this whole source exists for. `#project` is already in the workspace; typing
   * `#projects` must not silently become a second tag with a second hue.
   */
  assert.deepEqual(names(TAGS, "projects"), [
    "projects-archive",
    "project",
    "Create #projects",
  ]);
});

test("a name the workspace already has is never offered as a new one", () => {
  assert.deepEqual(names(TAGS, "project"), ["project", "projects-archive"]);
});

test("an existing tag in different casing is still the same tag", () => {
  assert.deepEqual(names(TAGS, "ATLAS"), ["Atlas"], "no Create row: this tag exists");
});

test("a genuinely new name is offered, and is the only row", () => {
  assert.deepEqual(names(TAGS, "quarterly"), ["Create #quarterly"]);
});

test("a typo still finds the tag it was aiming at", () => {
  assert.deepEqual(names(["project"], "projet"), ["project", "Create #projet"]);
});

test("a name the parser could not read back is never offered for creation", () => {
  // A tag cannot end on a separator, so `#half-` is not yet a name worth coining.
  assert.deepEqual(names(TAGS, "half-"), []);
  assert.deepEqual(names(TAGS, "-lead"), []);
});

test("an empty vocabulary still lets the first tag be created", () => {
  assert.deepEqual(names([], "first"), ["Create #first"]);
});

test("nothing typed yet never offers to create the empty tag", () => {
  assert.deepEqual(names([], ""), []);
});
