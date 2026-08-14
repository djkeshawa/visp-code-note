import assert = require("node:assert/strict");
import { test } from "node:test";
// Must come first: it installs the globals `@codemirror/view` reads while loading.
import { createHost } from "../support/domEnvironment";
import { CodeMirrorEditor } from "../../src/webview/editor/codeMirrorEditor";
import type { EditorSelectionReport } from "../../src/webview/editor/codeMirrorEditor";

/**
 * What the rest of the page is told about the caret.
 *
 * Nothing outside the editor could see the caret at all: the update listener returned unless
 * the document had changed, so the outline could not say which section was being written and
 * the view had no way to count the words in a selection. The cost is the whole problem —
 * `selectionSet` fires on every caret move and on every keystroke — so this is reported at
 * most once per frame, and these tests are as much about how often as about what.
 */

interface OpenEditor {
  readonly caretTo: (offset: number) => void;
  readonly select: (from: number, to: number) => void;
  readonly reports: () => readonly EditorSelectionReport[];
  readonly nextFrame: () => Promise<void>;
}

interface MountedView {
  readonly dispatch: (spec: unknown) => void;
}

function openNote(source: string): OpenEditor {
  const reports: EditorSelectionReport[] = [];
  const editor = new CodeMirrorEditor(createHost(), "test-nonce", source, {
    suggestions: () => [],
    workspaceTags: () => [],
    unresolvedLinks: () => new Set<string>(),
    sourcePatched: () => undefined,
    saveRequested: () => undefined,
    openLink: () => undefined,
    openExternal: () => undefined,
    noteTitle: () => "Atlas",
    selectionChanged: (report) => { reports.push(report); },
  });
  const view = (editor as unknown as { view: MountedView }).view;

  return {
    caretTo(offset) {
      view.dispatch({ selection: { anchor: offset } });
    },
    select(from, to) {
      view.dispatch({ selection: { anchor: from, head: to } });
    },
    reports: () => reports,
    nextFrame: () => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }),
  };
}

const NOTE = "# Atlas\n\nOpening prose.\n\n## Sources\n\nMore prose.\n";

test("moving the caret says where it went", async () => {
  const note = openNote(NOTE);
  await note.nextFrame();
  assert.equal(
    note.reports().length,
    1,
    "where the caret starts is said without waiting for a first keypress",
  );

  note.caretTo(NOTE.indexOf("More prose"));
  await note.nextFrame();

  const last = note.reports().at(-1);
  assert.equal(last?.caret, NOTE.indexOf("More prose"));
  assert.equal(last?.hasSelection, false);
});

test("a caret dragged across a frame is reported once, not once per step", async () => {
  const note = openNote(NOTE);
  await note.nextFrame();
  const before = note.reports().length;

  for (let step = 0; step < 20; step += 1) note.caretTo(step);
  await note.nextFrame();

  const reports = note.reports().slice(before);
  assert.equal(reports.length, 1, `twenty caret moves produced ${reports.length} reports`);
  assert.equal(reports[0]?.caret, 19, "and the one report is where the caret ended up");
});

test("a selection is reported as one", async () => {
  const note = openNote(NOTE);
  await note.nextFrame();
  note.select(2, 7);
  await note.nextFrame();

  assert.equal(note.reports().at(-1)?.hasSelection, true);
});

test("the caret is reported in the note's own offsets, not the editor's", async () => {
  /*
   * The editor normalises line endings to `\n`; the note on disk still has its own. An offset
   * reported in the editor's coordinates would land earlier and earlier down a CRLF note, and
   * the outline would name the wrong section.
   */
  const crlf = NOTE.replace(/\n/g, "\r\n");
  const note = openNote(crlf);
  await note.nextFrame();
  note.caretTo(crlf.replace(/\r\n/g, "\n").indexOf("More prose"));
  await note.nextFrame();

  assert.equal(note.reports().at(-1)?.caret, crlf.indexOf("More prose"));
});
