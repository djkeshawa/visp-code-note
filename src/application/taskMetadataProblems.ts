import type { NoteTask, OffsetRange } from "../domain/models";
import { parseDue, parseReminderLead } from "./dueDate";

/**
 * Task metadata that cannot do what it says.
 *
 * `@due(…)` and `@remind(…)` are read leniently — anything unrecognised is simply not a due
 * date — and that leniency is right for parsing but wrong as the only feedback. A task written
 * `@due(next friday)`, or one carrying a `@remind(30m)` and no due at all, looks like a task
 * that will interrupt you and never does. Nothing said so; the reminder was silently inert.
 *
 * Each problem is anchored on the token that causes it rather than on the whole line, so the
 * squiggle sits under the thing to fix.
 */

export const UNREADABLE_DUE_CODE = "vispNotes.unreadableDue";
export const UNREADABLE_REMINDER_CODE = "vispNotes.unreadableReminder";
export const REMINDER_WITHOUT_DUE_CODE = "vispNotes.reminderWithoutDue";

export interface TaskMetadataProblem {
  readonly range: OffsetRange;
  readonly message: string;
  readonly code: string;
}

const DUE_TOKEN = /@due\(\s*[^)]*?\s*\)/i;
const REMIND_TOKEN = /@remind\(\s*[^)]*?\s*\)/i;

export function taskMetadataProblems(
  source: string,
  tasks: readonly NoteTask[],
): readonly TaskMetadataProblem[] {
  const problems: TaskMetadataProblem[] = [];
  for (const task of tasks) {
    // Nothing is sliced until a task actually has a problem: this runs over every task in the
    // workspace on every index change, and almost none of them have one.
    if (task.due !== undefined && parseDue(task.due) === undefined) {
      problems.push({
        range: tokenRange(source, task.range, DUE_TOKEN),
        message:
          `Visp Notes cannot read the due date “${task.due}”. ` +
          "Use YYYY-MM-DD, optionally followed by a time: @due(2026-08-15 14:30).",
        code: UNREADABLE_DUE_CODE,
      });
    }

    if (task.remind === undefined) continue;

    if (parseReminderLead(task.remind) === undefined) {
      problems.push({
        range: tokenRange(source, task.range, REMIND_TOKEN),
        message:
          `Visp Notes cannot read the reminder “${task.remind}”, so this task will not ` +
          "notify. Use a number followed by m, h or d, up to 14d: @remind(30m).",
        code: UNREADABLE_REMINDER_CODE,
      });
    } else if (parseDue(task.due) === undefined) {
      problems.push({
        range: tokenRange(source, task.range, REMIND_TOKEN),
        message: task.due === undefined
          ? "This reminder never fires: the task has no @due(…) date to come before."
          : "This reminder never fires: the task's @due(…) date cannot be read.",
        code: REMINDER_WITHOUT_DUE_CODE,
      });
    }
  }
  return problems;
}

/** The token's own span, falling back to the whole task when it cannot be located. */
function tokenRange(source: string, task: OffsetRange, pattern: RegExp): OffsetRange {
  const match = pattern.exec(source.slice(task.start, task.end));
  if (match?.index === undefined) return task;
  return { start: task.start + match.index, end: task.start + match.index + match[0].length };
}
