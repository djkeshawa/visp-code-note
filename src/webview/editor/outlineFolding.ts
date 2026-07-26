import {
  codeFolding,
  foldAll,
  foldCode,
  foldGutter,
  foldService,
  unfoldAll,
  unfoldCode,
} from "@codemirror/language";
import { StateField } from "@codemirror/state";
import type { EditorState, Extension } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { outlineFoldAt } from "../../markdown/outline.js";

/**
 * Collapsible headings and list items.
 *
 * `@codemirror/lang-markdown` folds every block except headings and lists, so this supplies
 * exactly the two it leaves out. A fold service is asked about one line at a time and returns
 * the range to hide, which keeps the rule where it belongs: in `markdown/outline.ts`, over
 * plain lines, testable on its own.
 *
 * The hidden range starts at the end of the first line, so the heading or bullet stays visible
 * and keeps its affordance.
 */

/**
 * The document as an array of line strings, recomputed only when the text changes.
 *
 * The fold gutter asks the fold service about every visible line, so splitting the document
 * inside the service would make painting a screen cost O(visible × lines). Caching it against
 * the document version makes that one pass per edit instead.
 */
const documentLines = StateField.define<readonly string[]>({
  create: (state) => splitLines(state),
  update: (value, transaction) => transaction.docChanged ? splitLines(transaction.state) : value,
});

function splitLines(state: EditorState): readonly string[] {
  const lines: string[] = [];
  for (let number = 1; number <= state.doc.lines; number += 1) {
    lines.push(state.doc.line(number).text);
  }
  return lines;
}

const outlineFoldService = foldService.of((state, lineStart, lineEnd) => {
  const lines = state.field(documentLines, false) ?? splitLines(state);
  const startLine = state.doc.lineAt(lineStart);
  const fold = outlineFoldAt(lines, startLine.number - 1);
  if (fold === undefined) return null;
  const end = state.doc.line(fold.endLine + 1);
  return end.to > lineEnd ? { from: lineEnd, to: end.to } : null;
});

export const outlineFolding: Extension = [
  documentLines,
  codeFolding({ placeholderText: "…" }),
  outlineFoldService,
  /*
   * The gutter is always present so the text does not shift when a marker appears, but its
   * markers only show on hover or when something is folded. `media/editor.css` owns that.
   */
  foldGutter({
    markerDOM: (open) => {
      const marker = window.document.createElement("span");
      marker.className = `fold-marker codicon codicon-chevron-${open ? "down" : "right"}`;
      marker.setAttribute("aria-hidden", "true");
      return marker;
    },
  }),
  keymap.of([
    { key: "Mod-Alt-[", run: foldCode },
    { key: "Mod-Alt-]", run: unfoldCode },
    { key: "Mod-k Mod-0", run: foldAll },
    { key: "Mod-k Mod-j", run: unfoldAll },
  ]),
];
