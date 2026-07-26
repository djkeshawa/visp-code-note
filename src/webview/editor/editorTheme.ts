import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { tags } from "@lezer/highlight";

/**
 * Token colors are the one part of the editor's appearance CodeMirror has to own,
 * because Lezer tags have no CSS class contract we can target from a stylesheet.
 * Everything else — layout, spacing, panels, tooltips, selection, gutters — lives in
 * `media/editor.css` so there is a single place where the editor's look is decided.
 */
const highlightStyle = HighlightStyle.define([
  { tag: tags.heading, color: "var(--visp-text)", fontWeight: "700" },
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: [tags.link, tags.url], color: "var(--visp-accent)", textDecoration: "underline" },
  { tag: [tags.monospace, tags.processingInstruction], fontFamily: "var(--visp-mono)" },
  { tag: tags.quote, color: "var(--visp-muted)" },
  { tag: [tags.meta, tags.punctuation], color: "var(--visp-muted)" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.comment, color: "var(--vscode-editorCodeLens-foreground, var(--visp-muted))" },
]);

export const vispEditorTheme: Extension = [syntaxHighlighting(highlightStyle)];
