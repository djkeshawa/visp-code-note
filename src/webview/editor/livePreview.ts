import { StateEffect, StateField } from "@codemirror/state";
import type { Extension, Range } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
} from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import {
  findRecognizedWikiLink,
  isRecognizedWikiLink,
  markdownBlockAtPosition,
  markdownFormattingMarks,
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
  for (const visible of view.visibleRanges) {
    let position = view.state.doc.lineAt(visible.from).from;
    while (position <= visible.to && position <= view.state.doc.length) {
      const line = view.state.doc.lineAt(position);
      if (!visitedLines.has(line.from)) {
        visitedLines.add(line.from);
        decorateLine(view, line.from, line.to, line.text, unresolvedLinks, ranges);
      }
      if (line.to >= view.state.doc.length) break;
      position = line.to + 1;
    }
  }
  return Decoration.set(ranges, true);
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
      if (!active) {
        const markerFrom = from + (list[1]?.length ?? 0);
        ranges.push(Decoration.replace({
          widget: new ListMarkerWidget(list[2]),
        }).range(markerFrom, markerFrom + list[2].length));
      }
    }
  }
  if (block?.kind === "blockquote") {
    ranges.push(Decoration.line({ class: "live-quote-line" }).range(from));
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
