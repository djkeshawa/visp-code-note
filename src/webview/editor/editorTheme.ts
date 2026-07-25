import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";

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

export const vispEditorTheme: Extension = [
  EditorView.theme({
    "&": {
      height: "100%",
      backgroundColor: "transparent",
      color: "var(--visp-text)",
      fontSize: "var(--vscode-editor-font-size, 14px)",
    },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": {
      overflow: "auto",
      fontFamily: "var(--visp-font)",
    },
    ".cm-content": {
      width: "min(800px, calc(100% - 48px))",
      minHeight: "100%",
      margin: "0 auto",
      padding: "38px 0 120px",
      caretColor: "var(--visp-text)",
    },
    ".cm-line": {
      padding: "2px 8px",
      lineHeight: "1.7",
    },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: "var(--visp-text)",
    },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
      backgroundColor: "var(--vscode-editor-selectionBackground, #264f78)",
    },
    ".cm-activeLine": {
      backgroundColor: "color-mix(in srgb, var(--visp-surface-hover) 22%, transparent)",
    },
    ".cm-panels": {
      borderColor: "var(--visp-border)",
      backgroundColor: "var(--visp-panel)",
      color: "var(--visp-text)",
    },
    ".cm-tooltip": {
      border: "1px solid var(--vscode-widget-border, var(--visp-border))",
      borderRadius: "var(--visp-radius)",
      backgroundColor: "var(--vscode-editorSuggestWidget-background, var(--visp-surface))",
      color: "var(--vscode-editorSuggestWidget-foreground, var(--visp-text))",
    },
    ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
      backgroundColor: "var(--vscode-editorSuggestWidget-selectedBackground, var(--visp-surface-hover))",
      color: "var(--vscode-editorSuggestWidget-selectedForeground, var(--visp-text))",
    },
    ".cm-completionDetail": {
      color: "var(--vscode-descriptionForeground, var(--visp-muted))",
    },
    ".cm-searchMatch": {
      backgroundColor: "var(--vscode-editor-findMatchHighlightBackground, #ea5c0055)",
      outline: "1px solid var(--vscode-editor-findMatchHighlightBorder, transparent)",
    },
    ".cm-searchMatch.cm-searchMatch-selected": {
      backgroundColor: "var(--vscode-editor-findMatchBackground, #515c6a)",
    },
  }),
  syntaxHighlighting(highlightStyle),
];
