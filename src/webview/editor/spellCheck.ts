import { StateEffect, StateField } from "@codemirror/state";
import type { EditorState, Extension, Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, showTooltip } from "@codemirror/view";
import type { DecorationSet, Tooltip, ViewUpdate } from "@codemirror/view";
import { misspelledWords } from "../../application/spellCheckText.js";
import { spellSuggestions } from "../../application/spellSuggestions.js";
import type { SpellDictionary } from "../../application/spellDictionary.js";
import type { OffsetRange } from "../../domain/models.js";
import { findTags } from "../../markdown/tags.js";
import {
  markdownBlockAtPosition,
  markdownFrontmatterRange,
  markdownInlineCodeRanges,
  markdownInlineLinks,
} from "./markdownContext.js";
import { wikiLinkSpans } from "./wikiLinkSpans.js";

/**
 * Spelling, underlined where it is prose and nowhere else.
 *
 * The dictionary arrives after the editor does — it is a 672KB file the webview fetches — so
 * everything here copes with there being no dictionary yet and simply draws nothing. When it
 * lands, an effect drops it in and the visible lines are checked.
 *
 * Only the visible lines are ever checked. Spell-checking a whole note on every keystroke
 * would be work proportional to the note for a result the reader cannot see, and a long note
 * is exactly where that becomes noticeable.
 */

export const setSpellDictionary = StateEffect.define<SpellDictionary>();
const setSpellTooltip = StateEffect.define<Tooltip | null>();

const misspellingMark = Decoration.mark({ class: "live-misspelling" });

const dictionaryField = StateField.define<SpellDictionary | undefined>({
  create: () => undefined,
  update: (value, transaction) => {
    for (const effect of transaction.effects) {
      if (effect.is(setSpellDictionary)) return effect.value;
    }
    return value;
  },
});

/**
 * The parts of a line that are not English and must never be underlined.
 *
 * A notes file is mostly not prose: the target of a wiki link is a file name, a tag is an
 * address, inline code is code, a link's destination is a URL, and task markers are syntax.
 * Each is already found elsewhere, so this only collects them.
 */
function nonProseRanges(state: EditorState, from: number, to: number, text: string): OffsetRange[] {
  const ranges: OffsetRange[] = [];
  for (const span of wikiLinkSpans(text)) {
    ranges.push({ start: from + span.start, end: from + span.end });
  }
  for (const tag of findTags(text, from)) {
    ranges.push({ start: tag.start, end: tag.end });
  }
  for (const span of markdownInlineCodeRanges(state, from, to)) {
    ranges.push({ start: span.start, end: span.end });
  }
  for (const link of markdownInlineLinks(state, from, to)) {
    // The label is prose and is checked; the destination is a URL and is not.
    ranges.push({ start: link.labelEnd, end: link.end });
  }
  // `@due(2026-08-14)`, `@priority(high)` and the identifier the extension writes.
  for (const match of text.matchAll(/@(?:due|remind|priority)\([^)]*\)|<!--\s*task:[^>]*-->/gi)) {
    if (match.index === undefined) continue;
    ranges.push({ start: from + match.index, end: from + match.index + match[0].length });
  }
  return ranges;
}

function buildMisspellings(view: EditorView): DecorationSet {
  const dictionary = view.state.field(dictionaryField, false);
  if (dictionary === undefined) return Decoration.none;

  const ranges: Range<Decoration>[] = [];
  const frontmatter = markdownFrontmatterRange(view.state);
  for (const visible of view.visibleRanges) {
    let position = view.state.doc.lineAt(visible.from).from;
    while (position <= visible.to && position <= view.state.doc.length) {
      const line = view.state.doc.lineAt(position);
      const block = markdownBlockAtPosition(view.state, line.from);
      const inFrontmatter = frontmatter !== undefined && line.from < frontmatter.end;
      // Code is not prose, and neither is configuration.
      if (!inFrontmatter && block?.kind !== "code" && line.text.trim().length > 0) {
        const skip = nonProseRanges(view.state, line.from, line.to, line.text);
        for (const found of misspelledWords(line.text, dictionary, skip, line.from)) {
          ranges.push(misspellingMark.range(found.start, found.end));
        }
      }
      if (line.to >= view.state.doc.length) break;
      position = line.to + 1;
    }
  }
  return Decoration.set(ranges, true);
}

const spellPlugin = ViewPlugin.fromClass(class {
  public decorations: DecorationSet;

  public constructor(view: EditorView) {
    this.decorations = buildMisspellings(view);
  }

  public update(update: ViewUpdate): void {
    const dictionaryArrived = update.transactions.some((transaction) =>
      transaction.effects.some((effect) => effect.is(setSpellDictionary)));
    if (update.docChanged || update.viewportChanged || dictionaryArrived) {
      this.decorations = buildMisspellings(update.view);
    }
  }
}, { decorations: (value) => value.decorations });

/** The correction menu, which exists only while a misspelling has been clicked. */
const tooltipField = StateField.define<Tooltip | null>({
  create: () => null,
  update: (value, transaction) => {
    for (const effect of transaction.effects) {
      if (effect.is(setSpellTooltip)) return effect.value;
    }
    // Any edit invalidates where the menu was pointing.
    return transaction.docChanged ? null : value;
  },
  provide: (field) => showTooltip.from(field),
});

function correctionTooltip(
  view: EditorView,
  from: number,
  to: number,
  word: string,
  suggestions: readonly string[],
  onAddWord: (word: string) => void,
): Tooltip {
  return {
    pos: from,
    above: false,
    create: () => {
      const dom = document.createElement("div");
      dom.className = "live-spell-menu";
      const apply = (replacement: string): void => {
        view.dispatch({
          changes: { from, to, insert: replacement },
          effects: setSpellTooltip.of(null),
          userEvent: "input.complete",
        });
        view.focus();
      };
      if (suggestions.length === 0) {
        const empty = document.createElement("p");
        empty.className = "live-spell-empty";
        empty.textContent = "No suggestions";
        dom.append(empty);
      }
      for (const suggestion of suggestions) {
        const option = document.createElement("button");
        option.type = "button";
        option.className = "live-spell-option";
        option.textContent = suggestion;
        option.addEventListener("mousedown", (event) => {
          event.preventDefault();
          apply(suggestion);
        });
        dom.append(option);
      }
      const add = document.createElement("button");
      add.type = "button";
      add.className = "live-spell-add";
      add.textContent = `Add “${word}” to dictionary`;
      add.addEventListener("mousedown", (event) => {
        event.preventDefault();
        onAddWord(word);
        view.dispatch({ effects: setSpellTooltip.of(null) });
        view.focus();
      });
      dom.append(add);
      return { dom };
    },
  };
}

export interface SpellCheckOptions {
  /** Called when the reader accepts a word, so the host can remember it. */
  readonly addWord: (word: string) => void;
}

export function createSpellCheck(options: SpellCheckOptions): Extension {
  return [
    dictionaryField,
    tooltipField,
    spellPlugin,
    EditorView.domEventHandlers({
      mousedown: (event, view) => {
        const dictionary = view.state.field(dictionaryField, false);
        if (dictionary === undefined || event.button !== 0) return false;
        const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (position === null) return false;

        const line = view.state.doc.lineAt(position);
        const skip = nonProseRanges(view.state, line.from, line.to, line.text);
        const found = misspelledWords(line.text, dictionary, skip, line.from)
          .find((candidate) => position >= candidate.start && position <= candidate.end);
        if (found === undefined) {
          if (view.state.field(tooltipField) !== null) {
            view.dispatch({ effects: setSpellTooltip.of(null) });
          }
          return false;
        }

        /*
         * Suggestions are generated here rather than while decorating: building every word one
         * edit away is cheap for one word and pointless for every misspelling on screen.
         */
        event.preventDefault();
        view.dispatch({
          effects: setSpellTooltip.of(correctionTooltip(
            view,
            found.start,
            found.end,
            found.word,
            spellSuggestions(found.word, dictionary),
            options.addWord,
          )),
        });
        return true;
      },
    }),
  ];
}
