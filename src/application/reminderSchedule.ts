import type { IndexSnapshot } from "../domain/models";
import { dueMoment, reminderKey, reminderMoment } from "./dueDate";

/**
 * Which tasks are asking to be interrupted about, and when the next one will.
 *
 * Kept apart from the timer that fires them so the decision is testable: "given these tasks,
 * this clock and these already-delivered keys, what should happen" is a pure question, and it
 * is the whole of the feature's behaviour.
 */

export interface ReminderSettings {
  readonly enabled: boolean;
  /** Minutes after midnight a date-only due fires at. */
  readonly defaultMinutes: number;
  /** Lead applied to a task with no `@remind` of its own. */
  readonly defaultLeadMinutes: number;
  /** How stale a missed reminder may be and still be worth showing. */
  readonly catchUpWindowMs: number;
}

export interface ReminderCandidate {
  readonly key: string;
  readonly noteUri: string;
  readonly noteTitle: string;
  readonly start: number;
  readonly id?: string;
  readonly text: string;
  readonly due?: string;
  readonly completed: boolean;
  /** When to interrupt. */
  readonly at: number;
  /** When the task is actually due, which is what the toast says. */
  readonly dueAt: number;
}

export interface ReminderDecision {
  /** Show these now. */
  readonly deliver: readonly ReminderCandidate[];
  /**
   * Record these as delivered without showing them. A workspace reopened after a fortnight
   * holds a fortnight of missed reminders, and none of them is news.
   */
  readonly suppress: readonly ReminderCandidate[];
  /** The next moment worth waking for, absent when nothing is pending. */
  readonly nextAt?: number;
}

/**
 * Which past moments are still worth interrupting about.
 *
 * `watchSince` is when the scheduler started looking — activation. A reminder whose moment
 * falls after it came due while somebody was watching for it, and is news. One whose moment
 * falls before it is history: it is either caught up once at startup, inside the window, or
 * silently written off.
 *
 * This is what stops typing a due date that has already gone by from setting off an alarm for
 * it. Writing `@due(2026-08-15)` at nine in the evening means a task due this morning, not a
 * task to be interrupted about this instant.
 */
export interface ReminderWindow {
  readonly watchSince: number;
  /** True only for the one startup pass, which is the only place history is delivered. */
  readonly catchUp: boolean;
}

/** Every incomplete task with a readable due, as a reminder that could fire. */
export function reminderCandidates(
  snapshot: IndexSnapshot,
  settings: ReminderSettings,
): readonly ReminderCandidate[] {
  const candidates: ReminderCandidate[] = [];
  for (const task of snapshot.tasks) {
    if (task.completed) continue;
    const at = reminderMoment(
      task.due,
      task.remind,
      settings.defaultMinutes,
      settings.defaultLeadMinutes,
    );
    const dueAt = dueMoment(task.due, settings.defaultMinutes);
    if (at === undefined || dueAt === undefined) continue;
    candidates.push({
      key: reminderKey(task.noteUri, task.id, at),
      noteUri: task.noteUri,
      noteTitle: task.noteTitle,
      start: task.range.start,
      ...(task.id === undefined ? {} : { id: task.id }),
      text: task.text,
      ...(task.due === undefined ? {} : { due: task.due }),
      completed: task.completed,
      at,
      dueAt,
    });
  }
  return candidates;
}

/**
 * What to do about those candidates right now.
 *
 * A candidate already delivered is neither shown nor scheduled — that is what stops a reminder
 * repeating every time the index moves, which on an actively edited workspace is constantly.
 */
export function decideReminders(
  candidates: readonly ReminderCandidate[],
  now: number,
  isDelivered: (key: string) => boolean,
  settings: ReminderSettings,
  window: ReminderWindow,
): ReminderDecision {
  if (!settings.enabled) return { deliver: [], suppress: [] };

  const deliver: ReminderCandidate[] = [];
  const suppress: ReminderCandidate[] = [];
  const seen = new Set<string>();
  let nextAt: number | undefined;

  for (const candidate of candidates) {
    if (isDelivered(candidate.key) || seen.has(candidate.key)) continue;
    seen.add(candidate.key);
    if (candidate.at > now) {
      nextAt = nextAt === undefined ? candidate.at : Math.min(nextAt, candidate.at);
    } else if (shouldInterrupt(candidate.at, now, settings, window)) {
      deliver.push(candidate);
    } else {
      suppress.push(candidate);
    }
  }

  deliver.sort((left, right) => left.at - right.at);
  return { deliver, suppress, ...(nextAt === undefined ? {} : { nextAt }) };
}

/** Whether a moment that has already gone by is still worth a notification. */
function shouldInterrupt(
  at: number,
  now: number,
  settings: ReminderSettings,
  window: ReminderWindow,
): boolean {
  if (at >= window.watchSince) return true;
  return window.catchUp && now - at <= settings.catchUpWindowMs;
}
