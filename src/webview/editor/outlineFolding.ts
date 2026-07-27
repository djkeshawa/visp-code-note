import {
  codeFolding,
  foldAll,
  foldEffect,
  foldService,
  foldedRanges,
  unfoldAll,
  unfoldEffect,
} from "@codemirror/language";
import { StateField } from "@codemirror/state";
import type { EditorState, Extension, Range } from "@codemirror/state";
import { Decoration, ViewPlugin, WidgetType, keymap } from "@codemirror/view";
import type { EditorView } from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import { fencedLines, outlineFoldAt } from "../../markdown/outline.js";

/**
 * Collapsible headings and list items.
 *
 * `@codemirror/lang-markdown` folds every block except headings and lists, so this supplies the
 * two it leaves out: a heading collapses to the next heading of the same or higher level, and a
 * list item collapses its nested children.
 *
 * The control is an inline chevron in the left margin of each foldable line, not a fold gutter.
 * A gutter was tried and was wrong twice over. Horizontally it is pinned to the scroller's edge
 * while note content is centred on a reading measure, which stranded the chevrons 218px from the
 * text they belonged to. Vertically its rows are laid out at the editor's base line height while
 * live mode sets its own on the content, so markers drifted out of step with the lines — rows
 * 25px apart against markers 14px apart, two of them overlapping — and a chevron folded a
 * different line from the one it appeared beside. That is what made deeper nesting look broken.
 * Anchoring the control to the line removes both faults by construction.
 *
 * Folding is presentation only: nothing is written to the document. An outliner that stores
 * `collapsed:: true` in the Markdown puts view state into the user's notes, where it appears in
 * diffs and in every other editor.
 */

/**
 * The document as an array of line strings, recomputed only when the text changes. The fold
 * service is consulted per line, so splitting the document inside it would make painting a
 * screen cost O(visible × lines).
 */
interface DocumentOutline {
  readonly lines: readonly string[];
  /** Which of those lines sit inside a fenced block, worked out once per document. */
  readonly fenced: ReadonlySet<number>;
}

const documentLines = StateField.define<DocumentOutline>({
  create: (state) => readOutline(state),
  update: (value, transaction) => transaction.docChanged ? readOutline(transaction.state) : value,
});

function readOutline(state: EditorState): DocumentOutline {
  const lines: string[] = [];
  for (let number = 1; number <= state.doc.lines; number += 1) {
    lines.push(state.doc.line(number).text);
  }
  return { lines, fenced: fencedLines(lines) };
}

interface FoldRange {
  readonly from: number;
  readonly to: number;
}

/** The range a line would collapse, hidden from the end of that line so it stays visible. */
function foldRangeForLine(state: EditorState, lineNumber: number): FoldRange | undefined {
  if (lineNumber < 1 || lineNumber > state.doc.lines) return undefined;
  /*
   * The fenced-line set comes from the field rather than being recomputed here. This runs once
   * per visible line on every repaint, and working the set out each time made painting a screen
   * cost the whole document over again — 25ms a keystroke on a ten-thousand-line note.
   */
  const outline = state.field(documentLines, false) ?? readOutline(state);
  const fold = outlineFoldAt(outline.lines, lineNumber - 1, outline.fenced);
  if (fold === undefined) return undefined;
  const start = state.doc.line(lineNumber);
  const end = state.doc.line(Math.min(fold.endLine + 1, state.doc.lines));
  return end.to > start.to ? { from: start.to, to: end.to } : undefined;
}

/** The folded range beginning on this line, when the line is currently collapsed. */
function foldedAt(state: EditorState, lineTo: number): FoldRange | undefined {
  let found: FoldRange | undefined;
  foldedRanges(state).between(lineTo, lineTo, (from, to) => {
    if (from === lineTo) {
      found = { from, to };
      return false;
    }
    return undefined;
  });
  return found;
}

class FoldChevron extends WidgetType {
  public constructor(
    private readonly lineNumber: number,
    private readonly folded: boolean,
  ) {
    super();
  }

  public override eq(other: FoldChevron): boolean {
    return this.lineNumber === other.lineNumber && this.folded === other.folded;
  }

  public override toDOM(view: EditorView): HTMLElement {
    const toggle = window.document.createElement("span");
    toggle.className =
      `live-fold-toggle codicon codicon-chevron-${this.folded ? "right" : "down"}`;
    toggle.setAttribute("role", "button");
    toggle.setAttribute("aria-label", this.folded ? "Expand section" : "Collapse section");
    toggle.setAttribute("aria-expanded", String(!this.folded));
    toggle.addEventListener("mousedown", (event) => {
      // Claim the press so the caret does not jump to the chevron's position.
      event.preventDefault();
      event.stopPropagation();
      toggleFold(view, this.lineNumber);
    });
    return toggle;
  }

  public override ignoreEvent(): boolean {
    return false;
  }
}

function toggleFold(view: EditorView, lineNumber: number): void {
  if (lineNumber < 1 || lineNumber > view.state.doc.lines) return;
  const line = view.state.doc.line(lineNumber);
  const folded = foldedAt(view.state, line.to);
  if (folded !== undefined) {
    view.dispatch({ effects: unfoldEffect.of(folded) });
    return;
  }
  const range = foldRangeForLine(view.state, lineNumber);
  if (range !== undefined) view.dispatch({ effects: foldEffect.of(range) });
}

function buildChevrons(view: EditorView): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  const seen = new Set<number>();
  for (const visible of view.visibleRanges) {
    let position = visible.from;
    while (position <= visible.to && position <= view.state.doc.length) {
      const line = view.state.doc.lineAt(position);
      if (!seen.has(line.number)) {
        seen.add(line.number);
        if (foldRangeForLine(view.state, line.number) !== undefined) {
          const folded = foldedAt(view.state, line.to) !== undefined;
          /*
           * The chevron is anchored after the line's indentation, not at its start, so on a
           * nested line it hangs beside the text it collapses instead of out at the left
           * margin, several levels away from the block it belongs to.
           */
          const indent = /^[ \t]*/.exec(line.text)?.[0]?.length ?? 0;
          ranges.push(
            Decoration.line({ class: "live-foldable" }).range(line.from),
            Decoration.widget({
              widget: new FoldChevron(line.number, folded),
              side: -1,
            }).range(line.from + indent),
          );
        }
      }
      if (line.to >= view.state.doc.length) break;
      position = line.to + 1;
    }
  }
  return Decoration.set(ranges, true);
}

const foldChevrons = ViewPlugin.fromClass(class {
  public decorations: DecorationSet;

  public constructor(view: EditorView) {
    this.decorations = buildChevrons(view);
  }

  public update(update: ViewUpdate): void {
    // Folding changes no text, so a transaction carrying a fold effect must also refresh.
    const foldChanged = update.transactions.some((transaction) =>
      transaction.effects.some((effect) => effect.is(foldEffect) || effect.is(unfoldEffect)));
    if (update.docChanged || update.viewportChanged || foldChanged) {
      this.decorations = buildChevrons(update.view);
    }
  }
}, { decorations: (value) => value.decorations });

export const outlineFolding: Extension = [
  documentLines,
  codeFolding({ placeholderText: "⋯" }),
  foldService.of((state, lineStart) =>
    foldRangeForLine(state, state.doc.lineAt(lineStart).number) ?? null),
  foldChevrons,
  keymap.of([
    { key: "Mod-Alt-[", run: (view) => { toggleFold(view, view.state.doc.lineAt(view.state.selection.main.head).number); return true; } },
    { key: "Mod-k Mod-0", run: foldAll },
    { key: "Mod-k Mod-j", run: unfoldAll },
  ]),
];
