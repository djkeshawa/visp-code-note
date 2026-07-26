/**
 * The measure used for note content. Shared by the extension host (which owns the
 * `vispNotes.editor.contentWidth` setting) and the webview (which applies it), so the
 * two can never disagree about the supported values.
 */
export const EDITOR_CONTENT_WIDTHS = ["readable", "wide", "full"] as const;

export type EditorContentWidth = typeof EDITOR_CONTENT_WIDTHS[number];

/** Prose is easiest to read at a constrained measure, so that is the default. */
export const DEFAULT_EDITOR_CONTENT_WIDTH: EditorContentWidth = "readable";

export function parseEditorContentWidth(value: unknown): EditorContentWidth {
  return EDITOR_CONTENT_WIDTHS.some((width) => width === value)
    ? value as EditorContentWidth
    : DEFAULT_EDITOR_CONTENT_WIDTH;
}
