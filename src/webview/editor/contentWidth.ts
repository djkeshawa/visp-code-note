import { parseEditorContentWidth } from "../../application/editorContentWidth.js";
import type { EditorContentWidth } from "../../application/editorContentWidth.js";

export {
  DEFAULT_EDITOR_CONTENT_WIDTH,
  EDITOR_CONTENT_WIDTHS,
  parseEditorContentWidth,
} from "../../application/editorContentWidth.js";
export type { EditorContentWidth } from "../../application/editorContentWidth.js";

const STATE_KEY = "editorContentWidth";

/**
 * The setting is authoritative, but it only reaches the webview with the first
 * `editor/state` message. Caching the last applied width in webview state lets a
 * reloaded panel paint at the right measure instead of flashing the default.
 */
export function editorContentWidthFromState(state: unknown): EditorContentWidth {
  return parseEditorContentWidth(isRecord(state) ? state[STATE_KEY] : undefined);
}

export function stateWithEditorContentWidth(
  state: unknown,
  contentWidth: EditorContentWidth,
): Readonly<Record<string, unknown>> {
  return {
    ...(isRecord(state) ? state : {}),
    [STATE_KEY]: contentWidth,
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
