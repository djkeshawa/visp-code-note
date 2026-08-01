import type { IndexSnapshot } from "../domain/models";

/**
 * What is late or landing today.
 *
 * Deliberately narrower than All Tasks, which is the whole backlog: this row answers "what do I
 * owe right now", and a list that also carried next month's work and the undated would be the
 * backlog again under a second name.
 *
 * It does include work that slipped, though. Scoped strictly to the current date, a task that
 * missed its day left the list altogether — so the one surface meant to say what was owed went
 * quiet exactly when something had been forgotten.
 */

export type DueBucket = "overdue" | "today" | "upcoming" | "undated";

export type DueTask = IndexSnapshot["tasks"][number] & { readonly bucket: DueBucket };

export interface DueSelection {
  /** As many as the panel will draw, late first. */
  readonly rows: readonly DueTask[];
  /** Everything late or due today, which is what the row's count reports. */
  readonly total: number;
  /** How many are late, which is the figure worth colouring. */
  readonly overdue: number;
}

export function selectDueTasks(
  snapshot: IndexSnapshot,
  today: string,
  limit = Number.POSITIVE_INFINITY,
): DueSelection {
  const due = snapshot.tasks
    .filter((task) => !task.completed)
    .map((task): DueTask => ({ ...task, bucket: bucketFor(task.due, today) }))
    .filter((task) => task.bucket === "overdue" || task.bucket === "today");

  due.sort(compare);
  return {
    rows: Number.isFinite(limit) ? due.slice(0, limit) : due,
    total: due.length,
    overdue: due.filter((task) => task.bucket === "overdue").length,
  };
}

export function bucketFor(due: string | undefined, today: string): DueBucket {
  const key = due?.slice(0, 10);
  if (key === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return "undated";
  if (key < today) return "overdue";
  return key === today ? "today" : "upcoming";
}

/**
 * Late first, and the oldest slip first of all, because that is the one most likely to have
 * been forgotten. Within a bucket the due moment orders them, then the text.
 */
function compare(left: DueTask, right: DueTask): number {
  if (left.bucket !== right.bucket) return left.bucket === "overdue" ? -1 : 1;
  return (left.due ?? "").localeCompare(right.due ?? "") || left.text.localeCompare(right.text);
}
