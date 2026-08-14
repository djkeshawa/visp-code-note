/**
 * Editor repaint benchmark. Not part of `npm test` — run it directly:
 *
 *   npm run compile:test && node out-tests/test/benchmarks/editorRepaintPerformance.bench.js
 *
 * Two paths, because they have different budgets and different causes:
 *
 *   - keystroke: a character typed into the middle of the note. Every state field keyed on
 *     `docChanged` re-reads the whole document here, so this grows with the note.
 *   - caret move: an arrow key. Nothing is re-parsed, but the live-preview decorations are
 *     rebuilt for the visible lines, and each visible line used to ask questions that walked
 *     the whole document's block and link lists. That made a caret move cost
 *     O(visible × blocks), which is why it is measured on its own.
 *
 * Measured on the machine this was written on, in milliseconds per event, before → after the
 * range index behind `markdownFormattingMarks` and the binary search in
 * `markdownBlockAtPosition`:
 *
 *                 1,000 lines    5,000 lines   10,000 lines
 *   keystroke     5.8 → 4.2      21.9 → 12.2    41.9 → 23.6
 *   caret move    2.8 → 0.56     11.1 → 0.43    21.7 → 0.27
 *
 * The caret column is the point: it stops growing with the note at all. The keystroke column
 * still carries the two full-document parses those state fields run, which is why it goes on
 * growing — this removes the repaint on top of them, not the parses.
 *
 * One thing this harness cannot show: jsdom never scrolls, so the viewport here is always the
 * first screenful, where walking the block list from the front finds its answer immediately.
 * A reader halfway down a long note paid for the walk on every visible line, and that is
 * pinned in test/application/markdownContext.test.ts instead.
 *
 * The second table answers the question the caret signal has to answer for itself, since
 * `selectionSet` fires on every caret move and on every keystroke. At 10,000 lines and 196
 * outline entries, a caret move dispatched with the listener attached measured 5.29ms against
 * 5.38ms without it, and again 3.36ms against 3.50ms — that is to say, nothing above the
 * noise. The frame's own work — reading the caret out, walking the outline and moving one
 * class — is 0.18ms, once per frame however many caret moves have piled up.
 *
 * Read the absolute numbers in that table as a pair, not as a reading. The same measurement
 * taken in a fresh process is 0.86ms; everything this file has already mounted is still on
 * the heap when it runs.
 *
 * The last two lines are what a pause in the typing costs, and they are the reason the pause
 * is where that work now happens: at 10,000 lines, redrawing the outline and the task list is
 * 76ms and counting the words is 8ms. Both of those used to be inside a keystroke. Roughly
 * half of the 76ms is the parse and the rest is building 196 rows, which jsdom does far more
 * slowly than a browser — read it as an upper bound.
 */

// Must come first: it installs the globals `@codemirror/view` reads while loading.
import { createHost, window } from "../support/domEnvironment";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { proseWordCount } from "../../src/application/proseWordCount";
import { EDITOR_BODY } from "../../src/ui/pageBodies";
import { CodeMirrorEditor } from "../../src/webview/editor/codeMirrorEditor";
import { createLivePreview } from "../../src/webview/editor/livePreview";
import { markdownContext } from "../../src/webview/editor/markdownContext";
import {
  getNoteInspectorElements,
  markCurrentOutlineEntry,
  renderNoteInspector,
} from "../../src/webview/editor/noteInspector";
import { outlineFolding } from "../../src/webview/editor/outlineFolding";

const SIZES = [1_000, 5_000, 10_000] as const;

function noteOfLines(lines: number): string {
  const out: string[] = ["---", "title: Benchmark", "tags: [alpha, beta]", "---", ""];
  let index = 0;
  while (out.length < lines) {
    index += 1;
    if (index % 25 === 0) {
      out.push(`## Section ${index}`, "");
      continue;
    }
    if (index % 40 === 0) {
      out.push("```ts", "const value = 1;", "```", "");
      continue;
    }
    if (index % 17 === 0) {
      out.push(`- [ ] task ${index} @due(2026-08-14) #work`, "");
      continue;
    }
    out.push(
      `Paragraph ${index} with a [[Note ${index % 50}]] link, **bold** text, ` +
      `\`code\` and a #tag${index % 12} address.`,
      "",
    );
  }
  return out.slice(0, lines).join("\n");
}

function mount(source: string): EditorView {
  return new EditorView({
    parent: createHost(),
    state: EditorState.create({
      doc: source,
      extensions: [
        markdown({ base: markdownLanguage }),
        markdownContext,
        outlineFolding,
        createLivePreview({
          unresolvedLinks: () => new Set<string>(),
          openLink: () => undefined,
          openExternal: () => undefined,
          noteTitle: () => "Benchmark",
        }),
      ],
    }),
  });
}

function median(samples: readonly number[]): number {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function timeEach(runs: number, action: (run: number) => void): number {
  const samples: number[] = [];
  for (let run = 0; run < runs; run += 1) {
    const start = performance.now();
    action(run);
    samples.push(performance.now() - start);
  }
  return median(samples);
}

/**
 * What the caret signal costs, which is the question the signal has to answer for itself:
 * `selectionSet` fires on every caret move and on every keystroke, so a listener here could
 * undo everything above.
 *
 * Two costs, measured apart because they happen at different moments. The dispatch is what
 * happens inside the keypress; the report is what happens on the next frame, once, however
 * many caret moves have piled up since.
 */
function caretSignalReport(): string {
  const source = noteOfLines(10_000);
  window.document.body.innerHTML = EDITOR_BODY;
  const inspector = getNoteInspectorElements();
  renderNoteInspector(inspector, source, undefined, {
    reveal: () => undefined,
    openBacklink: () => undefined,
    toggleTask: () => undefined,
    openLink: () => undefined,
  });
  const headings = inspector.outline.children.length;

  const measureDispatch = (listening: boolean): number => {
    const editor = new CodeMirrorEditor(createHost(), "bench-nonce", source, {
      suggestions: () => [],
      workspaceTags: () => [],
      unresolvedLinks: () => new Set<string>(),
      sourcePatched: () => undefined,
      saveRequested: () => undefined,
      openLink: () => undefined,
      openExternal: () => undefined,
      noteTitle: () => "Benchmark",
      ...(listening
        ? { selectionChanged: (report) => markCurrentOutlineEntry(inspector, report.caret) }
        : {}),
    });
    const view = (editor as unknown as { view: EditorView }).view;
    const anchor = view.state.doc.line(Math.floor(view.state.doc.lines / 2)).from;
    view.dispatch({ selection: { anchor } });
    const elapsed = timeEach(60, (run) => {
      view.dispatch({ selection: { anchor: anchor + (run % 40) } });
    });
    editor.destroy();
    return elapsed;
  };

  /*
   * Each configuration is mounted and measured twice, and only the second reading is kept.
   * Measuring each once said the listener doubled the cost of a caret move; measured again in
   * the other order it said the same of the silent one. It was the just-in-time compiler
   * warming up, not the listener.
   */
  measureDispatch(false);
  measureDispatch(true);
  const silent = measureDispatch(false);
  const listening = measureDispatch(true);
  const report = timeEach(200, (run) => {
    markCurrentOutlineEntry(inspector, run * 97);
  });
  // What happens 150ms after the typing stops, rather than inside each keystroke.
  const drawOutline = timeEach(10, () => {
    renderNoteInspector(inspector, source, undefined, {
      reveal: () => undefined,
      openBacklink: () => undefined,
      toggleTask: () => undefined,
      openLink: () => undefined,
    }, "draft");
  });
  const count = timeEach(10, () => {
    proseWordCount(source);
  });

  return [
    `caret signal, 10,000 lines and ${headings} outline entries:`,
    `  dispatch, no listener   ${silent.toFixed(3)}ms`,
    `  dispatch, listening     ${listening.toFixed(3)}ms`,
    `  the frame's own work    ${report.toFixed(3)}ms`,
    "",
    "the idle pass, once the typing pauses:",
    `  outline and task list   ${drawOutline.toFixed(2)}ms`,
    `  word count              ${count.toFixed(2)}ms`,
    "",
  ].join("\n");
}

// First, while the process is still young: mounting three ten-thousand-line editors below
// leaves enough garbage behind to double every absolute reading taken after it.
process.stdout.write(`\n${caretSignalReport()}\n`);

const rows: string[] = [];
for (const size of SIZES) {
  const view = mount(noteOfLines(size));
  const middle = Math.floor(view.state.doc.lines / 2);
  const anchor = view.state.doc.line(middle).from;

  // Warm the fields and the syntax tree so the first sample is not the outlier.
  view.dispatch({ selection: { anchor } });

  const caret = timeEach(60, (run) => {
    view.dispatch({ selection: { anchor: anchor + (run % 40) } });
  });
  const keystroke = timeEach(40, () => {
    view.dispatch({ changes: { from: anchor, insert: "x" }, selection: { anchor: anchor + 1 } });
  });

  rows.push(`${String(size).padStart(6)}  ${keystroke.toFixed(2).padStart(9)}  ${caret.toFixed(2).padStart(10)}`);
  view.destroy();
}

process.stdout.write(`\n lines  keystroke  caret move\n${rows.join("\n")}\n\n`);
