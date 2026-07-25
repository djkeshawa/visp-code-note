import type { OffsetRange } from "../domain/models";

export interface OffsetTextEdit extends OffsetRange {
  readonly text: string;
}

export function applyTextEdits(source: string, edits: readonly OffsetTextEdit[]): string {
  const ordered = [...edits].sort((left, right) => right.start - left.start);
  let nextSource = source;
  let previousStart = source.length + 1;

  for (const edit of ordered) {
    validateEdit(source, edit, previousStart);
    nextSource = `${nextSource.slice(0, edit.start)}${edit.text}${nextSource.slice(edit.end)}`;
    previousStart = edit.start;
  }

  return nextSource;
}

export function replaceRange(source: string, range: OffsetRange, text: string): string {
  return applyTextEdits(source, [{ ...range, text }]);
}

function validateEdit(source: string, edit: OffsetTextEdit, previousStart: number): void {
  if (!Number.isInteger(edit.start) || !Number.isInteger(edit.end)) {
    throw new RangeError("Text edit offsets must be integers.");
  }
  if (edit.start < 0 || edit.end < edit.start || edit.end > source.length) {
    throw new RangeError(`Invalid text edit range ${edit.start}..${edit.end}.`);
  }
  if (edit.end > previousStart) {
    throw new RangeError("Overlapping text edits are not allowed.");
  }
}
