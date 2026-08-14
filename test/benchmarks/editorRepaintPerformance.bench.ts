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
 */

// Must come first: it installs the globals `@codemirror/view` reads while loading.
import { createHost } from "../support/domEnvironment";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { createLivePreview } from "../../src/webview/editor/livePreview";
import { markdownContext } from "../../src/webview/editor/markdownContext";
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
