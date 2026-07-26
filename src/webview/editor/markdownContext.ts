import { syntaxTree } from "@codemirror/language";
import { StateField } from "@codemirror/state";
import type { EditorState } from "@codemirror/state";
import { analyzeMarkdownWikiSyntax } from "../../markdown/parser.js";
import type { MarkdownWikiAnalysis } from "../../markdown/parser.js";
import type { MarkdownBlock, OffsetRange, WikiLink } from "../../domain/models.js";

const formattingMarks = new Set(["EmphasisMark", "StrikethroughMark", "CodeMark"]);

export const markdownContext = StateField.define<MarkdownWikiAnalysis>({
  create: (state) => analyzeMarkdownWikiSyntax(state.sliceDoc()),
  update: (value, transaction) => transaction.docChanged
    ? analyzeMarkdownWikiSyntax(transaction.state.sliceDoc())
    : value,
});

export function isProtectedMarkdownPosition(state: EditorState, position: number): boolean {
  return contextFor(state).protectedRanges.some(
    (range) => range.start <= position && position < range.end,
  );
}

export function isRecognizedWikiLink(
  state: EditorState,
  from: number,
  to: number,
): boolean {
  return findRecognizedWikiLink(state, from, to) !== undefined;
}

export function findRecognizedWikiLink(
  state: EditorState,
  from: number,
  to: number,
): WikiLink | undefined {
  return contextFor(state).links.find(
    (link) => link.range.start === from && link.range.end === to,
  );
}

export function isMarkdownFormattingMark(
  state: EditorState,
  from: number,
  to: number,
): boolean {
  const node = syntaxTree(state).resolveInner(from, 1);
  return formattingMarks.has(node.name) && node.from === from && node.to === to;
}

export function markdownFormattingMarks(
  state: EditorState,
  from: number,
  to: number,
): readonly OffsetRange[] {
  const marks: OffsetRange[] = [];
  const context = contextFor(state);
  syntaxTree(state).iterate({
    from,
    to,
    enter: (node) => {
      let ancestor = node.node.parent;
      let insideLinkLabel = false;
      while (ancestor !== null) {
        if (ancestor.name === "Link" || ancestor.name === "Image") {
          insideLinkLabel = true;
          break;
        }
        ancestor = ancestor.parent;
      }
      const overlapsProtectedRange = context.protectedRanges.some(
        (range) => node.from < range.end && node.to > range.start,
      );
      if (
        formattingMarks.has(node.name) &&
        node.from >= from &&
        node.to <= to &&
        !context.links.some((link) => node.from < link.range.end && node.to > link.range.start) &&
        (
          node.name === "CodeMark" ||
          insideLinkLabel ||
          !overlapsProtectedRange
        )
      ) {
        marks.push({ start: node.from, end: node.to });
      }
    },
  });
  return marks;
}

export function markdownFrontmatterRange(state: EditorState): OffsetRange | undefined {
  return contextFor(state).frontmatterRange;
}

/** Inline code spans, so live presentation can render them as pills. */
export function markdownInlineCodeRanges(
  state: EditorState,
  from: number,
  to: number,
): readonly OffsetRange[] {
  const ranges: OffsetRange[] = [];
  syntaxTree(state).iterate({
    from,
    to,
    enter: (node) => {
      if (node.name === "InlineCode" && node.from >= from && node.to <= to) {
        ranges.push({ start: node.from, end: node.to });
      }
    },
  });
  return ranges;
}

export function markdownBlockAtPosition(
  state: EditorState,
  position: number,
): MarkdownBlock | undefined {
  return contextFor(state).blocks.find(
    (block) => block.range.start <= position && position < block.range.end,
  );
}

function contextFor(state: EditorState): MarkdownWikiAnalysis {
  return state.field(markdownContext, false) ?? analyzeMarkdownWikiSyntax(state.sliceDoc());
}
