import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { tags } from "@lezer/highlight";

/**
 * Token colours are the one part of the editor's appearance CodeMirror has to own, because
 * Lezer tags have no CSS class contract a stylesheet could target. Everything else — layout,
 * spacing, panels, tooltips, selection, gutters — lives in `media/editor.css` so there is a
 * single place where the editor's look is decided.
 *
 * The palette is assigned by meaning rather than by grammar, and the same hues are used for
 * prose and for code so a note reads as one document rather than as two:
 *
 *   structure   headings, keywords — the shape of the thing
 *   reference   links, function and property names — something named elsewhere
 *   literal     inline code, numbers, booleans — a value written down
 *   string      quoted text
 *   declare     types and classes — something being introduced
 *
 * Every value resolves through `media/base.css`, which supplies a light-theme variant and
 * steps aside entirely under high contrast.
 */
const highlightStyle = HighlightStyle.define([
  // Markdown prose.
  { tag: tags.heading, fontWeight: "700" },
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: [tags.link, tags.url], color: "var(--visp-hue-reference)", textDecoration: "underline" },
  { tag: tags.monospace, fontFamily: "var(--visp-mono)" },
  { tag: tags.quote, color: "var(--visp-muted-strong)" },
  { tag: [tags.meta, tags.processingInstruction], color: "var(--visp-muted)" },
  { tag: tags.strikethrough, textDecoration: "line-through" },

  // Fenced code. Comments stay the quietest thing on the line.
  { tag: tags.comment, color: "var(--visp-muted)", fontStyle: "italic" },
  { tag: [tags.keyword, tags.moduleKeyword, tags.controlKeyword], color: "var(--visp-hue-accentuate)" },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: "var(--visp-hue-string)" },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: "var(--visp-hue-literal)" },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: "var(--visp-hue-reference)" },
  { tag: [tags.typeName, tags.className, tags.namespace], color: "var(--visp-hue-declare)" },
  { tag: [tags.propertyName, tags.attributeName], color: "var(--visp-hue-reference)" },
  { tag: [tags.tagName], color: "var(--visp-hue-accentuate)" },
  { tag: [tags.definition(tags.variableName), tags.variableName], color: "var(--visp-text)" },
  // Declared after the plain-variable rule so a function being defined reads the same as one
  // being called, rather than falling through to body colour.
  {
    tag: [
      tags.definition(tags.function(tags.variableName)),
      tags.definition(tags.propertyName),
    ],
    color: "var(--visp-hue-reference)",
  },
  { tag: [tags.operator, tags.punctuation, tags.separator, tags.bracket], color: "var(--visp-muted-strong)" },
  { tag: tags.self, color: "var(--visp-hue-accentuate)", fontStyle: "italic" },
  { tag: tags.escape, color: "var(--visp-hue-literal)" },
  { tag: tags.invalid, color: "var(--visp-danger)" },
]);

export const vispEditorTheme: Extension = [syntaxHighlighting(highlightStyle)];
