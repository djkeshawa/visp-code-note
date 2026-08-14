/**
 * Bold, italic, code and strikethrough, as one toggle.
 *
 * Adding a mark is the easy half and the useless half on its own. Live mode hides every
 * EmphasisMark, StrikethroughMark and CodeMark on a line the caret is not on, so a reader who
 * wants to un-bold a word cannot see the asterisks to delete: they have to click back onto the
 * line first to make the punctuation appear. A command that only ever adds leaves that
 * unchanged, so this one reads the parse tree and removes the pair it finds.
 *
 * The plan is a pure function of the state, so every case below — a selection over a mark
 * boundary, one padded with spaces, one already carrying the marks, one in a code fence — is
 * decided and tested without an editor anywhere near it.
 */
import { syntaxTree } from "@codemirror/language";
import { EditorSelection } from "@codemirror/state";
import type { ChangeSpec, EditorState, SelectionRange } from "@codemirror/state";
import type { EditorView, KeyBinding } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { INLINE_MARKS } from "./inlineMarks.js";
import { markdownBlockAtPosition, markdownFrontmatterRange } from "./markdownContext.js";

export interface InlineFormatPlan {
  readonly changes: ChangeSpec;
  readonly selection: SelectionRange;
}

interface Span {
  readonly from: number;
  readonly to: number;
}

/**
 * What one press of a formatting key should do to the document, or nothing when the mark
 * would be meaningless where the caret is.
 */
export function planInlineFormat(
  state: EditorState,
  open: string,
  close: string,
): InlineFormatPlan | undefined {
  if (state.readOnly || declines(state, state.selection.main)) return undefined;

  const nodes = markNodes(open, close);
  const target = withoutSurroundingSpace(state, state.selection.main);
  const carried = enclosingMark(state, nodes, target, open, close);
  return carried === undefined
    ? planWrap(state, nodes, target, open, close)
    : planUnwrap(state, carried, target, open, close);
}

/** Runs the toggle as a single transaction, which is what makes it a single undo step. */
export function toggleWrap(view: EditorView, open: string, close: string): boolean {
  const plan = planInlineFormat(view.state, open, close);
  if (plan === undefined) return false;
  view.dispatch({
    changes: plan.changes,
    selection: plan.selection,
    /*
     * Not `input.type`: the history joins adjacent transactions carrying that event, which
     * would fold the toggle into the word typed just before it and make one Ctrl+Z undo both.
     */
    userEvent: "input.format",
    scrollIntoView: true,
  });
  return true;
}

/**
 * The formatting keys, for the Prec.highest keymap.
 *
 * Each returns false where it declines, so the key it borrowed still reaches the command
 * underneath — Mod-i is selectParentSyntax in the default keymap, and inside a code fence
 * that is the more useful of the two.
 */
export const inlineFormattingKeymap: readonly KeyBinding[] = Object.freeze(
  INLINE_MARKS.map((mark): KeyBinding => ({
    key: mark.key,
    run: (view: EditorView) => toggleWrap(view, mark.open, mark.close),
  })),
);

function markNodes(open: string, close: string): readonly string[] {
  return INLINE_MARKS.find((mark) => mark.open === open && mark.close === close)?.nodes ?? [];
}

/**
 * Where these marks are punctuation rather than formatting, and the key is better spent on
 * whatever it was bound to before.
 */
function declines(state: EditorState, range: Span): boolean {
  const frontmatter = markdownFrontmatterRange(state);
  if (frontmatter !== undefined && range.from < frontmatter.end) return true;
  if (markdownBlockAtPosition(state, range.from)?.kind === "code") return true;
  if (range.to !== range.from && markdownBlockAtPosition(state, range.to - 1)?.kind === "code") {
    return true;
  }
  // No inline mark survives a paragraph break: the asterisks either side of a blank line are
  // rendered as the literal characters they are.
  return /\n[ \t]*\n/.test(state.sliceDoc(range.from, range.to));
}

/**
 * The selection with its outer whitespace given back.
 *
 * A double-click often takes the trailing space with the word, and `**word **` is not bold in
 * any Markdown renderer — the closing delimiter has to be flush against the text it closes.
 */
function withoutSurroundingSpace(state: EditorState, range: Span): Span {
  const text = state.sliceDoc(range.from, range.to);
  const from = range.from + (text.length - text.trimStart().length);
  const to = range.to - (text.length - text.trimEnd().length);
  return from < to ? { from, to } : { from: range.from, to: range.from };
}

/** The node of this kind the selection already sits inside, when there is one. */
function enclosingMark(
  state: EditorState,
  nodes: readonly string[],
  target: Span,
  open: string,
  close: string,
): SyntaxNode | undefined {
  const tree = syntaxTree(state);
  const seeds = target.from === target.to
    ? [tree.resolveInner(target.from, -1), tree.resolveInner(target.from, 1)]
    : [tree.resolveInner(target.from, 1), tree.resolveInner(target.to, -1)];
  for (const seed of seeds) {
    for (let node: SyntaxNode | null = seed; node !== null; node = node.parent) {
      if (nodes.includes(node.name) && covers(node, target, open, close)) return node;
    }
  }
  return undefined;
}

/**
 * A caret has to be between the delimiters to count as inside; a selection only has to be
 * within the whole construct.
 *
 * The difference is what stops a caret parked immediately before `**bold**` from deleting a
 * mark the reader was about to type in front of.
 */
function covers(node: SyntaxNode, target: Span, open: string, close: string): boolean {
  return target.from === target.to
    ? node.from + open.length <= target.from && target.to <= node.to - close.length
    : node.from <= target.from && target.to <= node.to;
}

function planUnwrap(
  state: EditorState,
  node: SyntaxNode,
  target: Span,
  open: string,
  close: string,
): InlineFormatPlan | undefined {
  const removals = delimiterSpans(state, node, open, close);
  if (removals === undefined) return undefined;
  return planFor(state, removals, target);
}

function planWrap(
  state: EditorState,
  nodes: readonly string[],
  target: Span,
  open: string,
  close: string,
): InlineFormatPlan {
  if (target.from === target.to) {
    return {
      changes: { from: target.from, insert: open + close },
      selection: EditorSelection.cursor(target.from + open.length),
    };
  }
  /*
   * A selection can start inside one bold run and end outside it. Wrapping that as it stands
   * writes a delimiter whose partner is on the other side of the selection, and the reader is
   * left with literal asterisks in their sentence. The range grows to swallow any run of the
   * same kind it only half covers, and those inner delimiters are dropped, so what is written
   * is always one balanced pair.
   */
  const span = expandOverPartialMarks(state, nodes, target);
  const removals = [...span.marks];
  removals.sort((left, right) => left.from - right.from);
  return planFor(
    state,
    [
      ...removals,
      { from: span.from, to: span.from, insert: open },
      { from: span.to, to: span.to, insert: close },
    ],
    span,
  );
}

interface ExpandedSpan extends Span {
  readonly marks: readonly Span[];
}

function expandOverPartialMarks(
  state: EditorState,
  nodes: readonly string[],
  target: Span,
): ExpandedSpan {
  let { from, to } = target;
  let found = overlappingMarks(state, nodes, from, to);
  // Each pass can only widen the range, and a wider range can only reach more of the document,
  // so this settles; the bound is there because a parse tree is untrusted input like any other.
  for (let pass = 0; pass < 8; pass += 1) {
    const grownFrom = Math.min(from, ...found.map((node) => node.from));
    const grownTo = Math.max(to, ...found.map((node) => node.to));
    if (grownFrom === from && grownTo === to) break;
    from = grownFrom;
    to = grownTo;
    found = overlappingMarks(state, nodes, from, to);
  }
  const marks: Span[] = [];
  for (const node of found) {
    const spans = delimiterSpansFor(node);
    if (spans !== undefined) marks.push(...spans);
  }
  return { from, to, marks };
}

function overlappingMarks(
  state: EditorState,
  nodes: readonly string[],
  from: number,
  to: number,
): readonly SyntaxNode[] {
  const found: SyntaxNode[] = [];
  if (nodes.length === 0) return found;
  syntaxTree(state).iterate({
    from,
    to,
    enter: (node) => {
      if (nodes.includes(node.name) && node.from < to && node.to > from) found.push(node.node);
    },
  });
  return found;
}

/** The delimiter runs of a node, read from its own text so nothing is assumed about lengths. */
function delimiterSpans(
  state: EditorState,
  node: SyntaxNode,
  open: string,
  close: string,
): readonly Span[] | undefined {
  if (state.sliceDoc(node.from, node.from + open.length) !== open) return undefined;
  if (state.sliceDoc(node.to - close.length, node.to) !== close) return undefined;
  return [
    { from: node.from, to: node.from + open.length },
    { from: node.to - close.length, to: node.to },
  ];
}

/**
 * The same, for a node found by name rather than by delimiter.
 *
 * The grammar names a mark after the construct it belongs to rather than after the key that
 * writes it — `***word***` is a StrongEmphasis inside an Emphasis and both are delimited by
 * EmphasisMark — so the outermost mark children are the pair to remove.
 */
function delimiterSpansFor(node: SyntaxNode): readonly Span[] | undefined {
  const runs: SyntaxNode[] = [];
  for (let child = node.firstChild; child !== null; child = child.nextSibling) {
    if (child.name.endsWith("Mark")) runs.push(child);
  }
  const opening = runs[0];
  const closing = runs[runs.length - 1];
  if (opening === undefined || closing === undefined || opening === closing) return undefined;
  return [
    { from: opening.from, to: opening.to },
    { from: closing.from, to: closing.to },
  ];
}

/**
 * Turns a change list into a plan, carrying the reader's selection through it so the words
 * they had highlighted are still the words highlighted afterwards.
 */
function planFor(
  state: EditorState,
  changes: readonly ChangeSpec[],
  target: Span,
): InlineFormatPlan {
  const set = state.changes([...changes]);
  return {
    changes: set,
    selection: EditorSelection.range(set.mapPos(target.from, 1), set.mapPos(target.to, -1)),
  };
}
