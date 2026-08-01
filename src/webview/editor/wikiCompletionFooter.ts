import { ViewPlugin } from "@codemirror/view";
import type { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";

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
      if (tooltip === null || tooltip === undefined) return;
      if (this.footer.parentElement !== tooltip) tooltip.append(this.footer);
    }
  });
}
