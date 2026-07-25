import type { NoteTask } from "../domain/models";
import { replaceRange } from "./textEdits";

export function toggleTaskInSource(source: string, task: NoteTask): string {
  const checkbox = source.slice(task.checkboxRange.start, task.checkboxRange.end);
  const replacement = task.completed ? " " : "x";

  if (!/^[ xX]$/.test(checkbox)) {
    throw new Error("The task checkbox no longer matches the indexed source.");
  }

  return replaceRange(source, task.checkboxRange, replacement);
}
