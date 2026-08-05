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
 * The reminders still ahead of now, soonest first — what a panel means by "active".
 *
 * Delivered keys are deliberately not consulted: delivery only ever concerns moments already
 * past, and everything here is in the future.
 */
export function upcomingReminders(
  snapshot: IndexSnapshot,
  settings: ReminderSettings,
  now: number,
): readonly ReminderCandidate[] {
  if (!settings.enabled) return [];
  return reminderCandidates(snapshot, settings)
    .filter((candidate) => candidate.at > now)
    .sort((left, right) => left.at - right.at);
}

/**
 * What to do about those candidates right now.
 *
 * A candidate already delivered is neither shown nor scheduled — that is what stops a reminder
 * repeating every time the index moves, which on an actively edited workspace is constantly.
 */
/**
 * A moment already past is still worth showing once, so long as it is recent.
 *
 * An earlier version refused anything older than the session itself, which made a due date
 * typed in after the fact silently do nothing at all — the commonest way to write one. What
 * actually stops the notification storm is the reminder's identity: it is the note, the task id
 * and the moment, so editing the line cannot mint a new one. The window here only decides how
 * stale is too stale to mention.
 */
export function decideReminders(
  candidates: readonly ReminderCandidate[],
  now: number,
  isDelivered: (key: string) => boolean,
  settings: ReminderSettings,
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
    } else if (now - candidate.at <= settings.catchUpWindowMs) {
      deliver.push(candidate);
    } else {
      suppress.push(candidate);
    }
  }

  deliver.sort((left, right) => left.at - right.at);
  return { deliver, suppress, ...(nextAt === undefined ? {} : { nextAt }) };
}
