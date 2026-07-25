import assert = require("node:assert/strict");
import { test } from "node:test";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import {
  isMarkdownFormattingMark,
  isProtectedMarkdownPosition,
  isRecognizedWikiLink,
  markdownBlockAtPosition,
  markdownContext,
  markdownFormattingMarks,
} from "../../src/webview/editor/markdownContext";

test("shares authoritative protected ranges and wiki links with the editor", () => {
  const source = [
    "---",
    "related: [[Frontmatter]]",
    "---",
    "[standard]([[Destination]])",
    "`[[Inline code]]`",
    "<!-- [[Comment]] -->",
    "[[Visible|Readable label]]",
  ].join("\n");
  const state = createState(source);
  const visibleStart = source.indexOf("[[Visible");
  const visibleEnd = visibleStart + "[[Visible|Readable label]]".length;

  assert.equal(isProtectedMarkdownPosition(state, source.indexOf("[[Frontmatter")), true);
  assert.equal(isProtectedMarkdownPosition(state, source.indexOf("[[Destination")), true);
  assert.equal(isProtectedMarkdownPosition(state, source.indexOf("[[Inline code")), true);
  assert.equal(isProtectedMarkdownPosition(state, source.indexOf("[[Comment")), true);
  assert.equal(isRecognizedWikiLink(state, visibleStart, visibleEnd), true);
  assert.equal(
    isRecognizedWikiLink(
      state,
      source.indexOf("[[Destination"),
      source.indexOf("[[Destination") + "[[Destination]]".length,
    ),
    false,
  );
});

test("hides only syntax-tree formatting marks, not unmatched punctuation", () => {
  const source = "**strong** *emphasis* ~~strike~~ `code` unmatched **";
  const state = createState(source);
  const strong = source.indexOf("**");
  const emphasis = source.indexOf("*emphasis");
  const code = source.indexOf("`code`");
  const unmatched = source.lastIndexOf("**");

  assert.equal(isMarkdownFormattingMark(state, strong, strong + 2), true);
  assert.equal(isMarkdownFormattingMark(state, emphasis, emphasis + 1), true);
  assert.equal(isMarkdownFormattingMark(state, code, code + 1), true);
  assert.equal(isMarkdownFormattingMark(state, unmatched, unmatched + 2), false);
});

test("finds combined emphasis marks and authoritative block kinds", () => {
  const source = "***combined*** `code` **bold**\n\n* * *\n\n- item";
  const state = createState(source);
  const firstLineEnd = source.indexOf("\n");
  const marks = markdownFormattingMarks(state, 0, firstLineEnd)
    .map((range) => source.slice(range.start, range.end));

  assert.deepEqual(marks, ["*", "**", "**", "*", "`", "`", "**", "**"]);
  assert.equal(markdownBlockAtPosition(state, source.indexOf("* * *"))?.kind, "thematic-break");
  assert.equal(markdownBlockAtPosition(state, source.indexOf("- item"))?.kind, "list");
});

test("keeps bare URLs literal while preserving semantic inline formatting", () => {
  const source = "https://x/**path** and `code`, [**label**](target), plus **bold**";
  const state = createState(source);
  const marks = markdownFormattingMarks(state, 0, source.length);
  const urlMarker = source.indexOf("**");
  const codeMarker = source.indexOf("`code`");
  const linkLabelMarker = source.indexOf("**label");
  const boldMarker = source.lastIndexOf("**bold");

  assert.equal(marks.some((mark) => mark.start === urlMarker), false);
  assert.equal(marks.some((mark) => mark.start === codeMarker), true);
  assert.equal(marks.some((mark) => mark.start === linkLabelMarker), true);
  assert.equal(marks.some((mark) => mark.start === boldMarker), true);
});

function createState(source: string): EditorState {
  return EditorState.create({
    doc: source,
    extensions: [markdown({ base: markdownLanguage }), markdownContext],
  });
}
