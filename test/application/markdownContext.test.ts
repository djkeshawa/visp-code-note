import assert = require("node:assert/strict");
import { test } from "node:test";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import {
  findRecognizedWikiLink,
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

/*
 * The rest of this file is about what these answers are. The rest of the editor also cares what
 * they cost: the live view asks for the block at a position and for the formatting marks on a
 * line once per visible line, and it repaints on every caret move, not only on every edit. Both
 * questions used to be answered by walking the note's whole block list or its whole protected
 * range list, so moving the caret in a long note cost the note.
 */

/** A note of `count` lines, every one of them carrying something worth asking about. */
function noteOfLines(count: number): string {
  const lines: string[] = [];
  for (let index = 0; index < count; index += 1) {
    lines.push(
      `Paragraph ${index} with a [[Note ${index % 50}]] link, **bold** text and \`code\`.`,
      "",
    );
  }
  return lines.slice(0, count).join("\n");
}

/** One repaint of a screenful of lines, timed, twice — the second reading is the one used. */
function millisecondsPerScreenful(
  state: EditorState,
  firstLine: number,
  ask: (from: number, to: number) => void,
): number {
  const measure = (): number => {
    const started = process.hrtime.bigint();
    for (let repeat = 0; repeat < 20; repeat += 1) {
      for (let number = firstLine; number < firstLine + 36; number += 1) {
        const line = state.doc.line(number);
        ask(line.from, line.to);
      }
    }
    return Number(process.hrtime.bigint() - started) / 1e6 / 20;
  };
  measure();
  return measure();
}

/*
 * The two bounds below are ratios rather than stopwatch readings, so a slow machine cannot fail
 * them. Each is far above what the fixed code needs and far below what walking a list costs.
 */

test("a screenful of formatting marks costs the same on a long note as on a short one", () => {
  const ask = (state: EditorState) => (from: number, to: number): void => {
    markdownFormattingMarks(state, from, to);
    findRecognizedWikiLink(state, from, to);
  };
  const shortNote = createState(noteOfLines(200));
  const longNote = createState(noteOfLines(20_000));
  const short = millisecondsPerScreenful(shortNote, 1, ask(shortNote));
  const long = millisecondsPerScreenful(longNote, 1, ask(longNote));

  // A hundredfold more note used to mean a hundredfold more work: 0.8ms against 57ms.
  assert.ok(
    long < short * 5 + 1,
    `a screenful took ${short.toFixed(2)}ms at 200 lines and ${long.toFixed(2)}ms at 20,000`,
  );
});

test("a screenful at the end of a long note costs the same as one at its start", () => {
  const state = createState(noteOfLines(20_000));
  const ask = (from: number): void => {
    markdownBlockAtPosition(state, from);
  };
  const top = millisecondsPerScreenful(state, 1, ask);
  const bottom = millisecondsPerScreenful(state, state.doc.lines - 40, ask);

  /*
   * Walking the block list from the front made the answer cost the distance into the note, so
   * the same gesture at the bottom of a long note cost 20ms against 0.02ms at the top — and a
   * repaint asks this once per visible line, on every caret move.
   */
  assert.ok(
    bottom < top * 5 + 1,
    `a screenful took ${top.toFixed(3)}ms at the top and ${bottom.toFixed(3)}ms at the bottom`,
  );
});

test("the block at a position is the one a walk of the blocks would find", () => {
  const source = [
    "---",
    "title: Mixed",
    "---",
    "# Heading",
    "",
    "Paragraph one.",
    "",
    "- [ ] a task",
    "- a list item",
    "",
    "```ts",
    "const value = 1;",
    "```",
    "",
    "> quoted",
    "",
    "***",
    "",
    "Final paragraph ^anchor",
  ].join("\n");
  const state = createState(source);
  const blocks = state.field(markdownContext).blocks;

  for (let position = 0; position <= source.length; position += 1) {
    const walked = blocks.find(
      (block) => block.range.start <= position && position < block.range.end,
    );
    assert.equal(
      markdownBlockAtPosition(state, position),
      walked,
      `the block at offset ${position} disagrees with a walk of the block list`,
    );
  }
});

function createState(source: string): EditorState {
  return EditorState.create({
    doc: source,
    extensions: [markdown({ base: markdownLanguage }), markdownContext],
  });
}
