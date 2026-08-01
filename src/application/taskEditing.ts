import type { NoteTask } from "../domain/models";
import { parseMarkdown } from "../markdown/parser";
import { replaceRange } from "./textEdits";
import type { OffsetTextEdit } from "./textEdits";

/**
 * Plans a checkbox flip against the text as it stands right now.
 *
 * The task the caller holds was parsed from some earlier snapshot — a list in a side panel,
 * an index row — so its offsets may already have moved. The line is re-read from `source`
 * and the task's text has to still match before anything is written: a checkbox at the same
 * offset in a since-edited note is not the same task, and toggling it silently would flip
 * a line the user never pointed at.
 */
export function planTaskToggle(source: string, task: NoteTask): OffsetTextEdit | undefined {
  const current = parseMarkdown(source).tasks.find(
    (candidate) => candidate.line === task.line && candidate.text === task.text,
  );
  if (current === undefined) {
    return undefined;
  }
  return {
    start: current.checkboxRange.start,
    end: current.checkboxRange.end,
    text: current.completed ? " " : "x",
  };
}

export function toggleTaskInSource(source: string, task: NoteTask): string {
  const checkbox = source.slice(task.checkboxRange.start, task.checkboxRange.end);
  const replacement = task.completed ? " " : "x";

  if (!/^[ xX]$/.test(checkbox)) {
    throw new Error("The task checkbox no longer matches the indexed source.");
  }

  return replaceRange(source, task.checkboxRange, replacement);
}
