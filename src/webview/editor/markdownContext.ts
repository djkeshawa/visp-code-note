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

export interface InlineLinkRange {
  /** The whole `[label](target)` construct. */
  readonly start: number;
  readonly end: number;
  /** The visible label inside the brackets. */
  readonly labelStart: number;
  readonly labelEnd: number;
  /** True for an image, `![alt](src)`. */
  readonly image: boolean;
}

/**
 * Markdown links and images, read from the syntax tree rather than by regex so nested brackets
 * and escapes are handled by the parser that already understands them.
 */
export function markdownInlineLinks(
  state: EditorState,
  from: number,
  to: number,
): readonly InlineLinkRange[] {
  const links: InlineLinkRange[] = [];
  syntaxTree(state).iterate({
    from,
    to,
    enter: (node) => {
      if (node.name !== "Link" && node.name !== "Image") return;
      if (node.from < from || node.to > to) return;
      const text = state.sliceDoc(node.from, node.to);
      const image = node.name === "Image";
      const open = text.indexOf("[");
      const close = findLabelEnd(text, open);
      if (open === -1 || close === -1) return;
      links.push({
        start: node.from,
        end: node.to,
        labelStart: node.from + open + 1,
        labelEnd: node.from + close,
        image,
      });
    },
  });
  return links;
}

/** Matches the closing bracket of a label, allowing nested brackets inside it. */
function findLabelEnd(text: string, open: number): number {
  if (open === -1) return -1;
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    const character = text[index];
    if (character === "\\") {
      index += 1;
      continue;
    }
    if (character === "[") depth += 1;
    else if (character === "]") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
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

/**
 * The destination of the Markdown link covering `position`, when there is one.
 *
 * The label is what the reader clicks, so only a position inside the whole construct counts —
 * the destination text itself is hidden in Live mode.
 */
export function markdownLinkDestinationAt(
  state: EditorState,
  position: number,
): string | undefined {
  const line = state.doc.lineAt(position);
  const link = markdownInlineLinks(state, line.from, line.to)
    .find((candidate) => candidate.start <= position && position <= candidate.end);
  if (link === undefined || link.image) return undefined;
  const text = state.sliceDoc(link.labelEnd + 1, link.end);
  const inside = /^\((.*)\)$/s.exec(text)?.[1];
  if (inside === undefined) return undefined;
  // A destination may carry a title after it: `(https://example.com "Title")`.
  return inside.trim().split(/\s+/)[0];
}
