import { StateEffect, StateField } from "@codemirror/state";
import type { Extension, Range } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
} from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import { parseCalloutBlock } from "../../markdown/callouts.js";
import type { CalloutHeader } from "../../markdown/callouts.js";
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
} from "./markdownContext.js";
import { findWikiLinkAtPosition } from "./wikiLinkNavigation.js";
import { wikiLinkDisplayRange } from "./wikiLinkPresentation.js";

export interface LivePreviewOptions {
  readonly unresolvedLinks: () => ReadonlySet<string>;
  readonly openLink: (target: string, beside: boolean) => void;
}

export const refreshLivePreview = StateEffect.define<void>();
export const revealLiveLine = StateEffect.define<number | undefined>({
  map: (value, changes) => value === undefined ? undefined : changes.mapPos(value),
});

export function createLivePreview(options: LivePreviewOptions): Extension {
  const plugin = ViewPlugin.fromClass(class {
    public decorations: DecorationSet;

    public constructor(view: EditorView) {
      this.decorations = buildDecorations(view, options.unresolvedLinks());
    }

    public update(update: ViewUpdate): void {
      const refreshRequested = update.transactions.some((transaction) =>
        transaction.effects.some((effect) => effect.is(refreshLivePreview)));
      if (update.docChanged || update.selectionSet || update.viewportChanged || refreshRequested) {
        this.decorations = buildDecorations(update.view, options.unresolvedLinks());
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
        if (link === undefined) return false;
        if (!isRecognizedWikiLink(view.state, line.from + link.from, line.from + link.to)) {
          return false;
        }
        event.preventDefault();
        options.openLink(link.target, true);
        return true;
      },
    },
  });
  return [plugin, revealLineField];
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

class ListMarkerWidget extends WidgetType {
  public constructor(private readonly marker: string) {
    super();
  }

  public override eq(other: ListMarkerWidget): boolean {
    return this.marker === other.marker;
  }

  public override toDOM(): HTMLElement {
    const marker = document.createElement("span");
    marker.className = "live-list-marker";
    marker.textContent = /^[-+*]$/.test(this.marker) ? "•" : this.marker;
    marker.setAttribute("aria-hidden", "true");
    return marker;
  }
}

function buildDecorations(
  view: EditorView,
  unresolvedLinks: ReadonlySet<string>,
): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  const visitedLines = new Set<number>();
  const frontmatter = markdownFrontmatterRange(view.state);
  const tables = tableLayout(view);
  for (const visible of view.visibleRanges) {
    let position = view.state.doc.lineAt(visible.from).from;
    while (position <= visible.to && position <= view.state.doc.length) {
      const line = view.state.doc.lineAt(position);
      if (!visitedLines.has(line.from)) {
        visitedLines.add(line.from);
        const tableRole = tables.get(line.number);
        if (frontmatter !== undefined && line.from < frontmatter.end) {
          decorateFrontmatterLine(line.from, line.to, frontmatter, ranges);
        } else if (tableRole !== undefined) {
          decorateTableLine(view, line.from, line.to, line.text, tableRole, ranges);
        } else {
          decorateLine(view, line.from, line.to, line.text, unresolvedLinks, ranges);
        }
      }
      if (line.to >= view.state.doc.length) break;
      position = line.to + 1;
    }
  }
  return Decoration.set(ranges, true);
}

/**
 * Frontmatter stays fully visible and editable — it is metadata the author owns — but
 * reads as a property block rather than as the note's first paragraph.
 */
function decorateFrontmatterLine(
  from: number,
  to: number,
  frontmatter: { readonly start: number; readonly end: number },
  ranges: Range<Decoration>[],
): void {
  const isFence = from === frontmatter.start || to >= frontmatter.end - 1;
  ranges.push(
    Decoration.line({
      class: isFence ? "live-frontmatter-line is-fence" : "live-frontmatter-line",
    }).range(from),
  );
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
function tableLayout(view: EditorView): ReadonlyMap<number, TableRowLayout> {
  const document = view.state.doc;
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
        class: "live-table-cell",
        attributes: { style: `min-width: ${width + 2}ch` },
      }).range(from + cell.start, from + cell.end),
    );
  }
  for (const offset of pipePositions(text)) {
    ranges.push(
      Decoration.mark({ class: "live-table-pipe" }).range(from + offset, from + offset + 1),
    );
  }
}

function decorateLine(
  view: EditorView,
  from: number,
  to: number,
  text: string,
  unresolvedLinks: ReadonlySet<string>,
  ranges: Range<Decoration>[],
): void {
  const active = view.state.selection.ranges.some((selection) =>
    selection.from <= to && selection.to >= from);
  const block = markdownBlockAtPosition(view.state, from);

  if (block?.kind === "code") {
    ranges.push(Decoration.line({ class: "live-code-line" }).range(from));
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
      const indent = list[1]?.length ?? 0;
      /*
       * Nesting was rendered as literal spaces in a proportional face, which came to about
       * seven pixels a level — pressing Tab looked like it had done nothing. Giving the
       * leading whitespace a fixed width per level makes each step unmistakable while leaving
       * the characters in the document, so the caret still moves through them.
       */
      if (indent > 0) {
        const depth = Math.max(1, Math.round(indent / 2));
        ranges.push(
          Decoration.mark({
            class: "live-list-indent",
            attributes: { style: `--live-indent-depth: ${depth}` },
          }).range(from, from + indent),
        );
      }
      if (!active) {
        const markerFrom = from + indent;
        ranges.push(Decoration.replace({
          widget: new ListMarkerWidget(list[2]),
        }).range(markerFrom, markerFrom + list[2].length));
      }
    }
  }
  if (block?.kind === "blockquote") {
    const callout = parseCalloutBlock(block.source);
    if (callout === undefined) {
      ranges.push(Decoration.line({ class: "live-quote-line" }).range(from));
    } else {
      decorateCalloutLine(from, text, block.range.start === from, callout, active, ranges);
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
 * A callout is a blockquote whose first line declares a type. Every line of the block
 * carries the tone class so the border and tint span the whole callout, and the marker
 * itself collapses to an icon while the caret is elsewhere.
 */
function decorateCalloutLine(
  from: number,
  text: string,
  isHeader: boolean,
  callout: CalloutHeader,
  active: boolean,
  ranges: Range<Decoration>[],
): void {
  const classes = ["live-callout-line", `live-callout-${callout.tone}`];
  if (isHeader) classes.push("is-header");
  ranges.push(Decoration.line({ class: classes.join(" ") }).range(from));
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
