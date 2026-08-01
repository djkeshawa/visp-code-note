import { StateEffect, StateField } from "@codemirror/state";
import type { EditorState, Extension, Range } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
} from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import { parseCalloutBlock } from "../../markdown/callouts.js";
import { isExternalLink } from "../../application/externalLink.js";
import { indentColumns } from "../../markdown/outline.js";
import { findTags } from "../../markdown/tags.js";
import { dueUrgency, formatDueDate } from "../tasks/grouping.js";
import type { CalloutHeader } from "../../markdown/callouts.js";
import type { MarkdownBlock } from "../../domain/models.js";
import { pipePositions, rowCells, tableBlocks } from "../../markdown/tables.js";
import type { TableLineKind } from "../../markdown/tables.js";
import {
  findRecognizedWikiLink,
  isRecognizedWikiLink,
  markdownBlockAtPosition,
  markdownFormattingMarks,
  markdownFrontmatterRange,
  markdownInlineCodeRanges,
  markdownInlineLinks,
  markdownLinkDestinationAt,
} from "./markdownContext.js";
import { findWikiLinkAtPosition } from "./wikiLinkNavigation.js";
import { wikiLinkDisplayRange } from "./wikiLinkPresentation.js";

export interface LivePreviewOptions {
  readonly unresolvedLinks: () => ReadonlySet<string>;
  readonly openLink: (target: string, beside: boolean) => void;
  readonly openExternal: (url: string) => void;
  /** Used to spell out the link that reaches a block reference from another note. */
  readonly noteTitle: () => string;
}

/** Mirrors `parseBlockReferences`, matched against one line rather than the whole note. */
const BLOCK_REFERENCE = /(^|[\t ])\^([A-Za-z0-9][\w.-]*)([\t ]*)$/;

/** A top-level `key:` in frontmatter. Nested list items carry no key and stay as values. */
const FRONTMATTER_PROPERTY = /^([\t ]*)([A-Za-z0-9_][\w.-]*)[\t ]*:[\t ]*/;

/*
 * Mirrors the markers `parseTasks` reads, matched against one line. The due marker leaves the
 * space before it in the document so the badge does not collide with the word it follows;
 * the priority marker takes its own leading space with it, since it disappears entirely.
 */
const DUE_MARKER = /@due\(\s*([^)]+?)\s*\)/i;
const PRIORITY_MARKER = /\s*@priority\(\s*(?:low|medium|high)\s*\)/i;

const LINKING_PROPERTIES: ReadonlySet<string> = new Set(["tags", "aliases", "alias"]);

export const refreshLivePreview = StateEffect.define<void>();
export const revealLiveLine = StateEffect.define<number | undefined>({
  map: (value, changes) => value === undefined ? undefined : changes.mapPos(value),
});

export function createLivePreview(options: LivePreviewOptions): Extension {
  const plugin = ViewPlugin.fromClass(class {
    public decorations: DecorationSet;

    public constructor(view: EditorView) {
      this.decorations = buildDecorations(view, options.unresolvedLinks(), options.noteTitle());
    }

    public update(update: ViewUpdate): void {
      const refreshRequested = update.transactions.some((transaction) =>
        transaction.effects.some((effect) => effect.is(refreshLivePreview)));
      if (update.docChanged || update.selectionSet || update.viewportChanged || refreshRequested) {
        this.decorations = buildDecorations(
          update.view,
          options.unresolvedLinks(),
          options.noteTitle(),
        );
      }
    }
  }, {
    decorations: (value) => value.decorations,
    eventHandlers: {
      click: (event, view) => {
        if (!event.ctrlKey && !event.metaKey) return false;
        const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (position === null) return false;
        const line = view.state.doc.lineAt(position);
        const link = findWikiLinkAtPosition(line.text, position - line.from);
        if (link !== undefined) {
          if (!isRecognizedWikiLink(view.state, line.from + link.from, line.from + link.to)) {
            return false;
          }
          event.preventDefault();
          options.openLink(link.target, true);
          return true;
        }
        /*
         * A `[text](url)` was drawn as a link and underlined like one, but nothing opened it —
         * the handler only ever looked for wiki links, so following one silently did nothing.
         * The host decides what may actually be opened; this only avoids asking about the
         * destinations that plainly are not external.
         */
        const destination = markdownLinkDestinationAt(view.state, position);
        if (destination === undefined || !isExternalLink(destination)) return false;
        event.preventDefault();
        options.openExternal(destination);
        return true;
      },
    },
  });
  return [plugin, tableLayoutField, revealLineField];
}

class TaskWidget extends WidgetType {
  public constructor(
    private readonly checked: boolean,
    private readonly from: number,
    private readonly to: number,
    private readonly label: string,
    private readonly readOnly: boolean,
  ) {
    super();
  }

  public override eq(other: TaskWidget): boolean {
    return this.checked === other.checked &&
      this.from === other.from &&
      this.to === other.to &&
      this.label === other.label &&
      this.readOnly === other.readOnly;
  }

  public override toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement("span");
    wrapper.className = "live-task-widget";
    const checkbox = document.createElement("input");
    checkbox.className = "live-task-checkbox";
    checkbox.type = "checkbox";
    checkbox.checked = this.checked;
    checkbox.disabled = this.readOnly;
    checkbox.setAttribute("aria-label", this.label.length > 0 ? `Task: ${this.label}` : "Task");
    checkbox.addEventListener("change", () => {
      if (view.state.readOnly) {
        checkbox.checked = this.checked;
        return;
      }
      view.dispatch({
        changes: { from: this.from, to: this.to, insert: checkbox.checked ? "[x]" : "[ ]" },
        userEvent: "input",
      });
      view.focus();
    });
    wrapper.append(checkbox);
    return wrapper;
  }
}

/**
 * A due date, drawn as the date rather than as the syntax that records it. Urgency is a
 * colour: a task list is scanned, not read, and "is this late" is the only question the
 * scan is asking.
 */
class DueDateWidget extends WidgetType {
  public constructor(
    private readonly label: string,
    private readonly urgency: string,
  ) {
    super();
  }

  public override eq(other: DueDateWidget): boolean {
    return this.label === other.label && this.urgency === other.urgency;
  }

  public override toDOM(): HTMLElement {
    const badge = document.createElement("span");
    badge.className = `live-task-due is-${this.urgency}`;
    badge.textContent = `· ${this.label}`;
    return badge;
  }
}

class CalloutIconWidget extends WidgetType {
  public constructor(
    private readonly icon: string,
    private readonly kind: string,
  ) {
    super();
  }

  public override eq(other: CalloutIconWidget): boolean {
    return this.icon === other.icon && this.kind === other.kind;
  }

  public override toDOM(): HTMLElement {
    const wrapper = document.createElement("span");
    wrapper.className = "live-callout-icon";
    wrapper.title = this.kind;
    const glyph = document.createElement("span");
    glyph.className = `codicon ${this.icon}`;
    glyph.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.className = "sr-only";
    label.textContent = `${this.kind} callout`;
    wrapper.append(glyph, label);
    return wrapper;
  }
}

/**
 * A bullet is punctuation, and one repeated at every depth says nothing about depth. A rule
 * for the top level and a point beneath it means a nested list reads as a nested list even
 * where the indentation is shallow. Ordered markers keep their own numbers.
 */
class ListMarkerWidget extends WidgetType {
  public constructor(
    private readonly marker: string,
    private readonly depth: number,
  ) {
    super();
  }

  public override eq(other: ListMarkerWidget): boolean {
    return this.marker === other.marker && this.depth === other.depth;
  }

  public override toDOM(): HTMLElement {
    const marker = document.createElement("span");
    marker.className = "live-list-marker";
    marker.textContent = /^[-+*]$/.test(this.marker)
      ? (this.depth === 0 ? "—" : "·")
      : this.marker;
    marker.setAttribute("aria-hidden", "true");
    return marker;
  }
}

function buildDecorations(
  view: EditorView,
  unresolvedLinks: ReadonlySet<string>,
  noteTitle: string,
): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  const visitedLines = new Set<number>();
  const frontmatter = markdownFrontmatterRange(view.state);
  const tables = view.state.field(tableLayoutField, false) ?? tableLayout(view.state);
  for (const visible of view.visibleRanges) {
    let position = view.state.doc.lineAt(visible.from).from;
    while (position <= visible.to && position <= view.state.doc.length) {
      const line = view.state.doc.lineAt(position);
      if (!visitedLines.has(line.from)) {
        visitedLines.add(line.from);
        const tableRole = tables.get(line.number);
        if (frontmatter !== undefined && line.from < frontmatter.end) {
          decorateFrontmatterLine(view, line.from, line.to, line.text, frontmatter, ranges);
        } else if (tableRole !== undefined) {
          decorateTableLine(view, line.from, line.to, line.text, tableRole, ranges);
        } else {
          decorateLine(view, line.from, line.to, line.text, unresolvedLinks, noteTitle, ranges);
        }
      }
      if (line.to >= view.state.doc.length) break;
      position = line.to + 1;
    }
  }
  return Decoration.set(ranges, true);
}

/**
 * Frontmatter, drawn as the property card the design shows rather than as four lines of YAML.
 *
 * The text stays in the document and the caret still moves through all of it — the fences, the
 * colons and a list's brackets come back the moment the caret lands on their line, like every
 * other mark this editor hides. What changes is what is drawn when it does not: a key column,
 * a value column, and one rounded block around the pair.
 */
function decorateFrontmatterLine(
  view: EditorView,
  from: number,
  to: number,
  text: string,
  frontmatter: { readonly start: number; readonly end: number },
  ranges: Range<Decoration>[],
): void {
  const active = view.state.selection.ranges.some((selection) =>
    selection.from <= to && selection.to >= from);
  const isOpening = from === frontmatter.start;
  const isClosing = to >= frontmatter.end - 1;
  const classes = ["live-frontmatter-line"];

  if (isOpening || isClosing) {
    /*
     * The `---` fences say nothing the card does not already say by being a card, so they
     * collapse to nothing at all — the same treatment a table's delimiter row gets.
     */
    classes.push("is-fence");
    if (active) classes.push("is-active");
    ranges.push(Decoration.line({ class: classes.join(" ") }).range(from));
    addHiddenMarkup(ranges, from, to - from, active);
    return;
  }

  // The first and last property rows carry the card's rounded ends and its vertical padding.
  const document = view.state.doc;
  if (from === document.lineAt(frontmatter.start).to + 1) classes.push("is-first");
  if (to + 1 >= document.lineAt(Math.max(0, frontmatter.end - 1)).from) classes.push("is-last");
  ranges.push(Decoration.line({ class: classes.join(" ") }).range(from));

  const property = FRONTMATTER_PROPERTY.exec(text);
  if (property?.[2] === undefined) return;
  const keyFrom = from + (property[1]?.length ?? 0);
  const keyTo = keyFrom + property[2].length;
  ranges.push(Decoration.mark({ class: "live-frontmatter-key" }).range(keyFrom, keyTo));
  // The colon is punctuation between two columns that are already apart.
  addHiddenMarkup(ranges, keyTo, from + property[0].length - keyTo, active);

  const valueFrom = from + property[0].length;
  if (valueFrom >= to) return;
  const value = text.slice(property[0].length);
  /*
   * Tags and aliases are the two properties that are themselves navigation — every other
   * view keys off them — so they carry the identity hue rather than the prose colour.
   */
  const linking = LINKING_PROPERTIES.has(property[2].toLowerCase());
  ranges.push(
    Decoration.mark({
      class: linking ? "live-frontmatter-value is-linking" : "live-frontmatter-value",
    }).range(valueFrom, to),
  );
  // `tags: [research, active]` reads as `research, active`; the brackets are YAML, not content.
  if (!active && value.startsWith("[") && value.trimEnd().endsWith("]")) {
    const closing = valueFrom + value.trimEnd().length - 1;
    addHiddenMarkup(ranges, valueFrom, 1, false);
    addHiddenMarkup(ranges, closing, 1, false);
  }
}

interface TableRowLayout {
  readonly kind: TableLineKind;
  /** Shared across the whole table, so every row's columns land in the same place. */
  readonly columnWidths: readonly number[];
}

/**
 * Table roles and column widths keyed by 1-based line number. Computed for the whole document
 * because a row's role depends on the delimiter beneath the header, and its column widths
 * depend on every other row in the same table — neither of which a per-line pass can see.
 */
/**
 * Held in a field so it is worked out once per edit rather than once per repaint. The map
 * depends only on the text, but decorations are rebuilt whenever the selection moves too, so
 * recomputing it there re-split and re-scanned the whole document on every caret move.
 */
const tableLayoutField = StateField.define<ReadonlyMap<number, TableRowLayout>>({
  create: (state) => tableLayout(state),
  update: (value, transaction) => transaction.docChanged ? tableLayout(transaction.state) : value,
});

function tableLayout(state: EditorState): ReadonlyMap<number, TableRowLayout> {
  const document = state.doc;
  const lines: string[] = [];
  for (let number = 1; number <= document.lines; number += 1) {
    lines.push(document.line(number).text);
  }
  const layout = new Map<number, TableRowLayout>();
  for (const block of tableBlocks(lines)) {
    for (let line = block.startLine; line <= block.endLine; line += 1) {
      const kind: TableLineKind = line === block.startLine
        ? "header"
        : line === block.startLine + 1 ? "delimiter" : "body";
      layout.set(line + 1, { kind, columnWidths: block.columnWidths });
    }
  }
  return layout;
}

/**
 * Rows stay editable text. A monospace grid lines the columns up, the header reads as a
 * header, the pipes recede, and the delimiter row collapses to a rule unless the caret is on
 * it. Replacing the block with an HTML table would take the text out of the document the
 * caret moves through, which is the one thing this editor does not do.
 */
function decorateTableLine(
  view: EditorView,
  from: number,
  to: number,
  text: string,
  layout: TableRowLayout,
  ranges: Range<Decoration>[],
): void {
  const active = view.state.selection.ranges.some((selection) =>
    selection.from <= to && selection.to >= from);
  ranges.push(
    Decoration.line({ class: `live-table-line is-${layout.kind}` }).range(from),
  );
  if (layout.kind === "delimiter" && !active) {
    // Hidden entirely; the header line's bottom border stands in for it.
    addHiddenMarkup(ranges, from, to - from, false);
    return;
  }
  /*
   * Each cell is given the width of the widest cell in its column, in `ch` units against the
   * monospace face. That is what actually aligns the columns: the source text is never padded,
   * so a monospace font alone leaves the pipes ragged.
   */
  for (const cell of rowCells(text)) {
    const width = layout.columnWidths[cell.column];
    if (width === undefined || cell.end <= cell.start) continue;
    ranges.push(
      Decoration.mark({
        class: cell.column === 0 ? "live-table-cell is-first" : "live-table-cell",
        attributes: { style: `min-width: ${width + 2}ch` },
      }).range(from + cell.start, from + cell.end),
    );
  }
  /*
   * The pipes go once the columns hold their own shape. Dimming them was not enough: a row of
   * `| yes | yes |` still reads as source rather than as a table, and the column edge is carried
   * by the cell now. They come back with the caret, because that is when they are being edited.
   */
  for (const offset of pipePositions(text)) {
    if (active) {
      ranges.push(
        Decoration.mark({ class: "live-table-pipe" }).range(from + offset, from + offset + 1),
      );
    } else {
      addHiddenMarkup(ranges, from + offset, 1, false);
    }
  }
}

/**
 * Gives leading whitespace a fixed width per nesting level. The spaces stay in the document so
 * the caret still moves through them; only their painted width changes, which is what makes a
 * step of indentation visible in a proportional face.
 */
function addIndentWidth(ranges: Range<Decoration>[], from: number, whitespace: string): void {
  if (whitespace.length === 0) return;
  // Depth comes from columns, not characters, so one tab is a step rather than half of one.
  const depth = Math.max(1, Math.round(indentColumns(whitespace) / 2));
  ranges.push(
    Decoration.mark({
      class: "live-list-indent",
      attributes: { style: `--live-indent-depth: ${depth}` },
    }).range(from, from + whitespace.length),
  );
}

function decorateLine(
  view: EditorView,
  from: number,
  to: number,
  text: string,
  unresolvedLinks: ReadonlySet<string>,
  noteTitle: string,
  ranges: Range<Decoration>[],
): void {
  const active = view.state.selection.ranges.some((selection) =>
    selection.from <= to && selection.to >= from);
  const block = markdownBlockAtPosition(view.state, from);

  if (block?.kind === "code") {
    ranges.push(Decoration.line({ class: "live-code-line" }).range(from));
    decorateCodeFence(ranges, from, to, text, block, active);
  }
  if (block?.kind === "heading" && block.range.start === from) {
    const heading = /^(\s{0,3})(#{1,6})(?:\s+|$)/.exec(text);
    const level = block.headingLevel ?? heading?.[2]?.length;
    if (level !== undefined) {
      ranges.push(Decoration.line({ class: `live-heading-${level}` }).range(from));
    }
    if (heading?.[2] !== undefined) {
      addHiddenMarkup(ranges, from + (heading[1]?.length ?? 0), heading[2].length, active);
    }
  }
  if (block?.kind === "list" || block?.kind === "task") {
    const list = /^(\s*)((?:[-+*])|(?:\d+[.)]))(\s+)/.exec(text);
    if (list?.[2] !== undefined) {
      ranges.push(Decoration.line({ class: "live-list-line" }).range(from));
      const indent = list[1] ?? "";
      addIndentWidth(ranges, from, indent);
      if (!active) {
        const markerFrom = from + indent.length;
        ranges.push(Decoration.replace({
          widget: new ListMarkerWidget(list[2], Math.round(indentColumns(indent) / 2)),
        }).range(markerFrom, markerFrom + list[2].length));
      }
    } else {
      /*
       * A line of prose beneath a bullet belongs to the list block but carries no marker, so
       * the branch above skipped it and it kept its literal indentation — about seven pixels,
       * which is the gesture looking like it did nothing. It is nested like any other line.
       */
      addIndentWidth(ranges, from, /^[ \t]*/.exec(text)?.[0] ?? "");
    }
  }
  /*
   * An indented paragraph is nested too, and it used to keep its literal leading spaces, so
   * pressing Tab on a line without a bullet moved the text about seven pixels and read as
   * having done nothing at all. Frontmatter and table rows are decorated elsewhere and never
   * arrive here, and an indented code block is its own kind, so this reaches only prose whose
   * indentation really does mean nesting.
   */
  if (block?.kind === "paragraph") {
    addIndentWidth(ranges, from, /^[ \t]*/.exec(text)?.[0] ?? "");
  }
  /*
   * A line holding nothing but indentation is the one the caret sits on immediately after
   * Enter then Tab. Widening it too means that gesture moves the caret a whole level at once
   * instead of the width of two spaces, so the nesting is visible before anything is typed.
   */
  if (block?.kind === "blank" && text.length > 0 && text.trim() === "") {
    addIndentWidth(ranges, from, text);
  }
  if (block?.kind === "blockquote") {
    const callout = parseCalloutBlock(block.source);
    if (callout === undefined) {
      ranges.push(Decoration.line({ class: "live-quote-line" }).range(from));
      hideQuoteMarker(ranges, from, text, active);
    } else {
      decorateCalloutLine(
        from,
        text,
        block.range.start === from,
        to >= block.range.end - 1,
        callout,
        active,
        ranges,
      );
    }
  }
  if (block?.kind === "thematic-break") {
    ranges.push(Decoration.line({ class: "live-thematic-break" }).range(from));
    // Hiding the characters lets the line's CSS border be the rule itself.
    addHiddenMarkup(ranges, from, to - from, active);
  }

  if (block?.kind === "task") {
    const task = /^(\s*(?:(?:[-+*])|(?:\d+[.)]))\s+)\[([ xX])\]/.exec(text);
    if (!active && task?.[1] !== undefined && task[2] !== undefined) {
      const checkboxFrom = from + task[1].length;
      const checkboxTo = checkboxFrom + 3;
      const label = text.slice(task[0].length).trim();
      ranges.push(Decoration.replace({
        widget: new TaskWidget(
          task[2].toLowerCase() === "x",
          checkboxFrom,
          checkboxTo,
          label,
          view.state.readOnly,
        ),
      }).range(checkboxFrom, checkboxTo));
      if (task[2].toLowerCase() === "x") {
        ranges.push(Decoration.line({ class: "live-task-completed" }).range(from));
      }
      decorateTaskMetadata(ranges, from, text);
    }
  }

  /*
   * `#tag` is an address the rest of the tool navigates by, not a word in the sentence, so
   * it steps back from the prose the way a block anchor does. Kept out of code, where a `#`
   * is a comment or a preprocessor line rather than a tag.
   */
  if (block !== undefined && block.kind !== "code") {
    for (const tag of findTags(text, from)) {
      ranges.push(Decoration.mark({ class: "live-tag" }).range(tag.start, tag.end));
    }
  }

  for (const match of text.matchAll(/\[\[([^\]\r\n]+)\]\]/g)) {
    if (match.index === undefined) continue;
    const linkFrom = from + match.index;
    const linkTo = linkFrom + match[0].length;
    const link = findRecognizedWikiLink(view.state, linkFrom, linkTo);
    if (link === undefined) continue;
    const classes = unresolvedLinks.has(link.raw)
      ? "live-wiki-link is-unresolved"
      : "live-wiki-link";
    ranges.push(Decoration.mark({ class: classes }).range(linkFrom, linkTo));
    const display = wikiLinkDisplayRange(match[0], link.alias !== undefined);
    if (display === undefined) {
      addHiddenMarkup(ranges, linkFrom, 2, active);
      addHiddenMarkup(ranges, linkTo - 2, 2, active);
    } else {
      addHiddenMarkup(ranges, linkFrom, display.start, active);
      addHiddenMarkup(ranges, linkFrom + display.end, linkTo - linkFrom - display.end, active);
    }
  }

  if (
    !active &&
    block !== undefined &&
    block.kind !== "code" &&
    block.kind !== "thematic-break" &&
    block.kind !== "blank"
  ) {
    for (const mark of markdownFormattingMarks(view.state, from, to)) {
      addHiddenMarkup(ranges, mark.start, mark.end - mark.start, false);
    }
  }

  /*
   * A trailing `^id` is an anchor other notes link to, not a word in the sentence it ends.
   * Drawing it as a small chip separates it from the prose while leaving it as editable text,
   * and the tooltip spells out the link that reaches it — the one thing an author has to know
   * about a block reference and the one thing the syntax does not say.
   */
  if (block !== undefined && block.kind !== "code" && block.kind !== "blank") {
    const anchor = BLOCK_REFERENCE.exec(text);
    if (anchor?.[2] !== undefined) {
      const anchorFrom = from + text.length - (anchor[2].length + 1) - (anchor[3]?.length ?? 0);
      ranges.push(
        Decoration.mark({
          class: "live-block-ref",
          attributes: {
            title: `Block reference — link to this block with [[${noteTitle}^${anchor[2]}]]`,
          },
        }).range(anchorFrom, anchorFrom + anchor[2].length + 1),
      );
    }
  }

  if (block !== undefined && block.kind !== "code") {
    for (const span of markdownInlineCodeRanges(view.state, from, to)) {
      ranges.push(Decoration.mark({ class: "live-inline-code" }).range(span.start, span.end));
    }
    for (const link of markdownInlineLinks(view.state, from, to)) {
      const className = link.image ? "live-md-link is-image" : "live-md-link";
      ranges.push(Decoration.mark({ class: className }).range(link.labelStart, link.labelEnd));
      if (active) continue;
      // Hide the brackets and the target, leaving the label reading as a link.
      addHiddenMarkup(ranges, link.start, link.labelStart - link.start, false);
      addHiddenMarkup(ranges, link.labelEnd, link.end - link.labelEnd, false);
    }
  }
}

/**
 * `@due(2026-08-03)` and `@priority(high)` are how a task records its metadata, not how a
 * task should read. The due date becomes the date, coloured by how near it is; the priority
 * marker steps out of the sentence entirely — it is carried by the task list's margin bar
 * and by the inspector, and the raw text comes back the moment the caret lands on the line,
 * like every other mark this editor hides.
 */
function decorateTaskMetadata(
  ranges: Range<Decoration>[],
  from: number,
  text: string,
): void {
  const due = DUE_MARKER.exec(text);
  if (due?.[1] !== undefined) {
    /*
     * The marker is only ever replaced by something that still shows its value. Hiding it
     * when the value could not be parsed erased the due date from the rendered note while
     * the task list went on showing it — the author saw an undated task and had to click the
     * line to discover otherwise. An unparseable value is shown as written instead.
     */
    ranges.push(
      Decoration.replace({
        widget: new DueDateWidget(
          formatDueDate(due[1]) ?? due[1],
          dueUrgency(due[1]),
        ),
      }).range(from + due.index, from + due.index + due[0].length),
    );
  }
  const priority = PRIORITY_MARKER.exec(text);
  if (priority !== null) {
    addHiddenMarkup(ranges, from + priority.index, priority[0].length, false);
  }
}

/**
 * A callout is a blockquote whose first line declares a type. Every line of the block
 * carries the tone class so the border and tint span the whole callout, and the marker
 * itself collapses to an icon while the caret is elsewhere.
 */
function decorateCalloutLine(
  from: number,
  text: string,
  isHeader: boolean,
  isLast: boolean,
  callout: CalloutHeader,
  active: boolean,
  ranges: Range<Decoration>[],
): void {
  const classes = ["live-callout-line", `live-callout-${callout.tone}`];
  if (isHeader) classes.push("is-header", "is-first");
  if (isLast) classes.push("is-last");
  ranges.push(Decoration.line({ class: classes.join(" ") }).range(from));
  hideQuoteMarker(ranges, from, text, active);
  if (!isHeader || active) {
    return;
  }
  const markerFrom = from + callout.markerStart;
  const markerTo = from + Math.min(callout.markerEnd, text.length);
  if (markerTo > markerFrom) {
    ranges.push(
      Decoration.replace({
        widget: new CalloutIconWidget(callout.icon, callout.kind),
      }).range(markerFrom, markerTo),
    );
  }
}

/**
 * The `>` that marks a quote or a callout. The block already reads as one — it carries a left
 * edge and its own tone — so repeating the marker on every line only makes the prose ragged.
 * It comes back the moment the caret is on the line, like every other hidden mark here.
 */
function hideQuoteMarker(
  ranges: Range<Decoration>[],
  from: number,
  text: string,
  active: boolean,
): void {
  const marker = /^(\s{0,3})((?:>[ \t]?)+)/.exec(text);
  if (marker?.[2] === undefined) return;
  addHiddenMarkup(ranges, from + (marker[1]?.length ?? 0), marker[2].length, active);
}

/**
 * A fenced block's own fence. The block is already drawn as code, so the backticks are noise;
 * the language is not, and stays as a quiet label above the code.
 */
function decorateCodeFence(
  ranges: Range<Decoration>[],
  from: number,
  to: number,
  text: string,
  block: MarkdownBlock,
  active: boolean,
): void {
  const fence = /^(\s*)(`{3,}|~{3,})(\S*)/.exec(text);
  if (fence?.[2] === undefined) return;
  const opening = block.range.start === from;
  const closing = to >= block.range.end - 1;
  if (!opening && !closing) return;
  const markerFrom = from + (fence[1]?.length ?? 0);
  addHiddenMarkup(ranges, markerFrom, fence[2].length, active);
  const language = fence[3] ?? "";
  if (opening) {
    // The opening line is the box's cap and carries the language as a label above the code.
    ranges.push(Decoration.line({ class: "live-code-line is-open" }).range(from));
    if (language.length > 0 && !active) {
      const languageFrom = markerFrom + fence[2].length;
      ranges.push(
        Decoration.mark({ class: "live-code-lang" })
          .range(languageFrom, languageFrom + language.length),
      );
    }
  }
  if (closing) {
    /*
     * A closing fence says nothing — the box ends where it ends — so it collapses to the
     * block's bottom edge unless the caret is on it.
     */
    ranges.push(Decoration.line({ class: "live-code-line is-close" }).range(from));
  }
}

function addHiddenMarkup(
  ranges: Range<Decoration>[],
  from: number,
  length: number,
  active: boolean,
): void {
  if (!active && length > 0) {
    ranges.push(Decoration.replace({}).range(from, from + length));
  }
}

const revealLineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (value, transaction) => {
    let next = value.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (!effect.is(revealLiveLine)) continue;
      next = effect.value === undefined
        ? Decoration.none
        : Decoration.set([
            Decoration.line({ class: "live-reveal-line" })
              .range(transaction.state.doc.lineAt(effect.value).from),
          ]);
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});
