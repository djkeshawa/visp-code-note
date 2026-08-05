import { createTextPatch } from "../../application/textPatch.js";

export interface HostSourceChange {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
}

/**
 * How to bring the editor's document in line with what the host says the file now holds.
 *
 * The answer is the *smallest* change that gets there, and that is the whole point. Replacing
 * the document wholesale reaches the same text, but the undo history is a set of positions
 * into the document, and rewriting every position at once leaves nothing for those positions
 * to refer to — so the reader's own edits stop being undoable. Since a note is confirmed by
 * the host after every keystroke, that meant Ctrl+Z did nothing on any note being written in,
 * which is every note.
 *
 * Touching only the span that actually differs leaves the rest of the document — and so the
 * rest of the history — where it was.
 *
 * Returns `undefined` when the two already agree and nothing needs to be dispatched.
 */
export function hostSourceChange(
  current: string,
  next: string,
): HostSourceChange | undefined {
  const patch = createTextPatch(current, next);
  if (patch === undefined) return undefined;
  return { from: patch.start, to: patch.end, insert: patch.source };
}
