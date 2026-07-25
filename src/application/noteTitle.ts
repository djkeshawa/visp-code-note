import type { NoteRecord } from "../domain/models";
import { normalizeNoteKey } from "../domain/normalization";

export function validateNoteTitle(title: string): string | undefined {
  const candidate = title.trim();
  if (candidate === "") {
    return "A title is required.";
  }
  if (candidate.length > 200) {
    return "Keep note titles at 200 characters or fewer.";
  }
  if (/[\r\n\0]/.test(candidate)) {
    return "Note titles must fit on one line and cannot contain null characters.";
  }
  return undefined;
}

export function conflictingNote(
  notes: readonly NoteRecord[],
  title: string,
  excludedUri?: string,
): NoteRecord | undefined {
  const key = normalizeNoteKey(title);
  return notes.find(
    (note) => note.uri !== excludedUri && (
      normalizeNoteKey(note.title) === key ||
      note.aliases.some((alias) => normalizeNoteKey(alias) === key)
    ),
  );
}
