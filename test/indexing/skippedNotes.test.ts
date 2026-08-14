import assert = require("node:assert/strict");
import { test } from "node:test";
import type { SkippedNote } from "../../src/domain/models";
import { createNoteResolver, findSkippedNote } from "../../src/indexing/noteResolver";
import { makeNote } from "./fixtures";

/*
 * Which links a note the size limit skipped can still be recognised from.
 *
 * This is the question the note editor asks after a wiki link has resolved to nothing, and the
 * answer decides between two very different messages: "the note does not exist — create it?",
 * which for a skipped note is an offer to overwrite a file that is sitting on disk, and a
 * sentence naming the file and the setting that excluded it.
 *
 * The rule is deliberately narrower than the resolver's. A skipped file has never been read, so
 * it has no title and no aliases — those live in text nobody has looked at. Everything it can
 * be recognised by comes from its path.
 */

const ENORMOUS: SkippedNote = {
  uri: "file:///notes/enormous.md",
  path: "notes/enormous.md",
  sizeBytes: 9_000_000,
  limitBytes: 5_242_880,
};

const SOURCE_PATH = "desk/source.md";

function lookup(target: string, skipped: readonly SkippedNote[] = [ENORMOUS]): string | undefined {
  return findSkippedNote(skipped, SOURCE_PATH, target)?.path;
}

test("an empty skipped list recognises nothing", () => {
  assert.equal(lookup("enormous", []), undefined);
});

test("the file name is how the reader will usually have written the link", () => {
  assert.equal(lookup("enormous"), "notes/enormous.md");
  assert.equal(lookup("Enormous"), "notes/enormous.md");
  assert.equal(lookup("enormous.md"), "notes/enormous.md");
});

test("the full path, and a suffix of it, name the same file", () => {
  assert.equal(lookup("notes/enormous"), "notes/enormous.md");
  assert.equal(lookup("/notes/enormous.md"), "notes/enormous.md");
});

/*
 * A file directly in the workspace root has no path suffix at all — its file name IS its whole
 * path — so it is the one shape a rule set built only out of suffixes would silently miss.
 */
test("a file at the workspace root is named by its file name too", () => {
  const root: SkippedNote = { ...ENORMOUS, uri: "file:///big.md", path: "big.md" };

  assert.equal(findSkippedNote([root], SOURCE_PATH, "big")?.path, "big.md");
  assert.equal(findSkippedNote([root], SOURCE_PATH, "big.md")?.path, "big.md");
});

test("a path written from the note doing the linking is followed", () => {
  const beside: SkippedNote = { ...ENORMOUS, uri: "file:///desk/big.md", path: "desk/big.md" };

  assert.equal(findSkippedNote([beside], SOURCE_PATH, "./big")?.path, "desk/big.md");
  assert.equal(findSkippedNote([beside], SOURCE_PATH, "../desk/big")?.path, "desk/big.md");
});

/*
 * The rule that only shows itself when two files could answer: the resolver tries the path
 * relative to the note doing the linking before anything else, so a bare name means the file in
 * the same folder even when an alphabetically earlier one elsewhere shares it. Naming the wrong
 * file here would send the reader to raise a limit for a note they were not looking at.
 */
test("a file in the linking note's own folder wins over one that merely shares its name", () => {
  const here: SkippedNote = { ...ENORMOUS, uri: "file:///desk/big.md", path: "desk/big.md" };
  const elsewhere: SkippedNote = { ...ENORMOUS, uri: "file:///attic/big.md", path: "attic/big.md" };

  assert.equal(findSkippedNote([elsewhere, here], SOURCE_PATH, "big")?.path, "desk/big.md");
});

test("a link with the percent-escapes the editor writes still names the file", () => {
  const spaced: SkippedNote = {
    ...ENORMOUS,
    uri: "file:///notes/big%20note.md",
    path: "notes/big note.md",
  };

  assert.equal(findSkippedNote([spaced], SOURCE_PATH, "big%20note")?.path, "notes/big note.md");
});

/*
 * The honest limit of this. Nobody has read the file, so nobody knows it calls itself anything
 * — and answering "that is your note" from a guess would be a worse lie than the one being
 * fixed. A reader who linked by title is told the target does not exist, which is true of
 * every name anything in the workspace knows.
 */
test("a title nobody has read is not a name this can answer to", () => {
  assert.equal(lookup("My Enormous Note"), undefined);
});

test("an empty or whitespace target names nothing", () => {
  assert.equal(lookup(""), undefined);
  assert.equal(lookup("   "), undefined);
});

/*
 * Two skipped files can answer to one file name across different folders. The resolver settles
 * that by path order, and this settles it the same way — a reader comparing the message with
 * the note the same link would have opened should not see two different files named.
 */
test("two skipped files claiming one name are decided by path, as notes are", () => {
  const early: SkippedNote = { ...ENORMOUS, uri: "file:///a/big.md", path: "a/big.md" };
  const late: SkippedNote = { ...ENORMOUS, uri: "file:///z/big.md", path: "z/big.md" };

  assert.equal(findSkippedNote([late, early], SOURCE_PATH, "big")?.path, "a/big.md");
});

/*
 * The rule that keeps the two apart: a name an indexed note answers to is never claimed here,
 * because the editor only asks after the resolver has said no. Pinned so a future change that
 * asks this first cannot quietly start reporting an indexed note as missing.
 */
test("a name an indexed note owns is answered by the resolver, not by this", () => {
  const indexed = makeNote({ path: "notes/enormous.md", title: "Enormous" });
  const resolved = createNoteResolver([indexed]).resolve("file:///desk/source.md", "enormous");

  assert.equal(resolved?.uri, indexed.uri);
});
