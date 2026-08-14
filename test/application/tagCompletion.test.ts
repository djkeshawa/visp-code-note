import assert = require("node:assert/strict");
import { test } from "node:test";
import { CompletionContext } from "@codemirror/autocomplete";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { markdownContext } from "../../src/webview/editor/markdownContext";
import { TAG_COMPLETION_TYPE, tagCompletions } from "../../src/webview/editor/tagCompletion";

/*
 * The `#` menu against a real document.
 *
 * `tagSuggestionModel.test.ts` covers the ranking on its own; this covers the part that only
 * exists in an editor — where the menu opens, and the several places a `#` is not a tag at all
 * and a menu there would be actively wrong.
 */

const TAGS = ["project", "reading", "work/admin"];

function state(source: string): EditorState {
  return EditorState.create({
    doc: source,
    extensions: [markdown({ base: markdownLanguage }), markdownContext],
  });
}

function menuAt(source: string, at = source.length, explicit = false) {
  return tagCompletions(new CompletionContext(state(source), at, explicit), TAGS);
}

function labels(source: string, at = source.length, explicit = false): readonly string[] {
  return (menuAt(source, at, explicit)?.options ?? []).map(
    (option) => option.displayLabel ?? option.label,
  );
}

test("typing a tag mid-sentence offers what the workspace already has", () => {
  assert.deepEqual(labels("Filed under #pro"), ["#project", "Create #pro"]);
});

test("a near miss puts the existing tag above the new one", () => {
  // The whole point: `#project` exists, and `#projects` must not quietly become a second tag.
  assert.deepEqual(labels("Filed under #projects"), ["#project", "Create #projects"]);
});

test("picking a row writes the tag, hash and all", () => {
  const option = menuAt("Filed under #pro")?.options[0];

  assert.equal(option?.apply, "#project");
  assert.equal(menuAt("Filed under #pro")?.from, 12, "the replacement starts at the hash");
});

test("each row carries its own tag name, so it can be drawn in that tag's hue", () => {
  const option = menuAt("Filed under #pro")?.options[0];

  assert.equal(option?.type, `${TAG_COMPLETION_TYPE}project`);
});

test("a hash inside a wiki link belongs to the note picker, not to tags", () => {
  /*
   * `[[#Overview` links to a heading in this same note, and it is the one wiki-link shape the
   * tag grammar would otherwise accept: the `#` follows a `[`, which is a boundary character.
   * Every other form — `[[Atlas#Over` — is already refused because the `#` follows a letter.
   */
  assert.equal(menuAt("See [[#Over"), null);
});

test("a hash inside a finished wiki link is not a tag either", () => {
  assert.equal(menuAt("See [[#Overview]] here", 11), null);
});

test("a hash after a note name was never a tag to begin with", () => {
  assert.equal(menuAt("See [[Atlas#Over"), null);
});

test("a hash inside inline code is a character, not a tag", () => {
  // Caret inside a closed span: `Run `git log #pro` now`, just after the `o`.
  assert.equal(menuAt("Run `git log #pro` now", 17), null);
});

test("a hash in a code span that is still being opened is a tag, as the indexer reads it", () => {
  /*
   * No closing backtick means there is no code span — the text is literal, and the workspace
   * index will record `#pro` as a tag. Declining here would put the menu at odds with what the
   * note is about to mean.
   */
  assert.deepEqual(labels("Run `git log #pro"), ["#project", "Create #pro"]);
});

test("a hash inside a fenced code block is left alone", () => {
  // `#pro` on its own line inside a fence: the tag grammar would read this as a tag anywhere
  // else, so only knowing it is fenced code keeps the menu shut.
  assert.equal(menuAt("```sh\n#pro"), null);
});

test("a hash inside a link destination is a fragment, not a tag", () => {
  assert.equal(menuAt("A [link](http://x.dev/ #pro) here", 26), null);
});

test("a bare hash starting a line does not interrupt a heading being typed", () => {
  /*
   * `# Heading` is the most common line in a note. A menu that opened on the `#` of every
   * heading would be in the way of it all day.
   */
  assert.equal(menuAt("#"), null);
});

test("but a hash starting a line offers the vocabulary once a name is begun", () => {
  assert.deepEqual(labels("#pro"), ["#project", "Create #pro"]);
});

test("asking for the menu outright at a line start still opens it", () => {
  // This is what `/tag` does: it writes the `#` and asks for the menu behind it.
  assert.deepEqual(labels("#", 1, true), ["#project", "#reading", "#work/admin"]);
});

test("a hash bolted onto a word never opens a menu", () => {
  assert.equal(menuAt("written in C#"), null);
});

test("an empty vocabulary still offers to create the first tag", () => {
  const result = tagCompletions(new CompletionContext(state("#first"), 6, false), []);

  assert.deepEqual(
    (result?.options ?? []).map((option) => option.displayLabel),
    ["Create #first"],
  );
});
