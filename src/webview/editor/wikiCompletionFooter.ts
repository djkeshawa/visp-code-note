import { ViewPlugin } from "@codemirror/view";
import type { EditorView } from "@codemirror/view";
import type { EditorState, Extension } from "@codemirror/state";
import { slashQueryAt } from "./slashCompletion.js";
import { findTagQuery } from "./tagSuggestionModel.js";
import { findWikiQuery } from "./wikiSuggestionModel.js";

/**
 * The footer under the wiki-link suggestions.
 *
 * `@codemirror/autocomplete` has no hook for content below the option list — `addToOptions`
 * is per row — so the footer is appended to the tooltip once it exists. It is static, so it
 * is built once and re-parented rather than rebuilt for every keystroke.
 */
const KEYS: readonly (readonly [string, string])[] = [
  ["#", "heading"],
  ["^", "block"],
  ["|", "alias"],
];

/**
 * Whether the popup showing is the wiki-link one, and so the only one this footer is true of.
 *
 * Three sources share the popup and only one of them accepts `#`, `^` and `|`. The wiki test
 * runs first because two of them can answer at once: `[[#Overview` links to a heading in this
 * same note, and the tag grammar reads that `#` as opening a tag — asking about tags first
 * took the footer away at the exact moment it was explaining the character being typed.
 */
export function wikiFooterApplies(state: EditorState): boolean {
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  const prefix = state.sliceDoc(line.from, head);
  if (findWikiQuery(prefix, prefix.length, prefix.length) !== undefined) return true;
  if (slashQueryAt(state, head) !== undefined) return false;
  return findTagQuery(prefix) === undefined;
}

function buildFooter(): HTMLElement {
  const footer = document.createElement("div");
  footer.className = "wiki-completion-footer";
  footer.setAttribute("aria-hidden", "true");
  for (const [key, label] of KEYS) {
    const entry = document.createElement("span");
    if (key === "|") entry.className = "is-trailing";
    const glyph = document.createElement("b");
    glyph.textContent = key;
    entry.append(glyph, document.createTextNode(` ${label}`));
    footer.append(entry);
  }
  return footer;
}

export function wikiCompletionFooter(): Extension {
  return ViewPlugin.fromClass(class {
    private readonly footer = buildFooter();

    public constructor(private readonly view: EditorView) {
      this.attach();
    }

    public update(): void {
      this.attach();
    }

    public destroy(): void {
      this.footer.remove();
    }

    private attach(): void {
      const tooltip = this.view.dom.parentElement?.querySelector(".wiki-completion-tooltip")
        ?? document.querySelector(".wiki-completion-tooltip");
      /*
       * The popup is reused between the two sources, so the footer has to be taken away as
       * well as put up: the `#`, `^` and `|` suffixes belong to a wiki link and say nothing
       * about a block command.
       */
      if (tooltip === null || tooltip === undefined || tooltip.classList.contains("is-slash")) {
        this.footer.remove();
        return;
      }
      if (this.footer.parentElement !== tooltip) tooltip.append(this.footer);
    }
  });
}
