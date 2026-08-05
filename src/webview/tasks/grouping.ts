import type { TaskWire } from "../contracts.js";

export type TaskStatusFilter = "open" | "all" | "completed";
export type TaskGrouping = "due" | "note" | "tag";
export type TaskSortKey = "due" | "created" | "text";
export type TaskSortDirection = "asc" | "desc";
export type DueGroupName = "Overdue" | "Today" | "This week" | "Later" | "No due date" | "Completed";

const TASK_GROUPINGS: readonly TaskGrouping[] = ["due", "note", "tag"];
const TASK_SORT_KEYS: readonly TaskSortKey[] = ["due", "created", "text"];

export interface TaskFilter {
  readonly query: string;
  readonly status: TaskStatusFilter;
  readonly view: "all" | "today";
  /** Defaults to due-date buckets, the order most task lists are read in. */
  readonly groupBy?: TaskGrouping;
  /** How rows order within a group. Defaults to due date, soonest first. */
  readonly sortBy?: TaskSortKey;
  readonly direction?: TaskSortDirection;
}

export interface TaskGroup {
  readonly name: string;
  readonly tasks: readonly TaskWire[];
}

const NO_TAG = "No tag";

/*
 * The buckets the design names, in the order it reads them. "This week" is the horizon a task
 * list is actually read against; everything beyond it is "Later" rather than one long tail.
 */
const dueGroupOrder: readonly DueGroupName[] = [
  "Overdue",
  "Today",
  "This week",
  "Later",
  "No due date",
  "Completed",
];

export function parseTaskGrouping(value: unknown): TaskGrouping {
  return TASK_GROUPINGS.find((grouping) => grouping === value) ?? "due";
}

export function parseTaskSortKey(value: unknown): TaskSortKey {
  return TASK_SORT_KEYS.find((key) => key === value) ?? "due";
}

export function parseTaskSortDirection(value: unknown): TaskSortDirection {
  return value === "desc" ? "desc" : "asc";
}

export function groupTasks(
  tasks: readonly TaskWire[],
  filter: TaskFilter,
  today = localDateKey(new Date()),
): readonly TaskGroup[] {
  const visible = tasks.filter((task) => matchesFilter(task, filter, today));
  const compare = taskComparator(filter.sortBy ?? "due", filter.direction ?? "asc");
  switch (filter.groupBy ?? "due") {
    case "note":
      return groupByKeys(visible, (task) => [task.noteTitle], compare);
    case "tag":
      return groupByKeys(
        visible,
        (task) => task.tags.length === 0 ? [NO_TAG] : task.tags.map((tag) => `#${tag}`),
        compare,
      );
    case "due":
      return groupByDueDate(visible, today, compare);
  }
}

type TaskCompare = (left: TaskWire, right: TaskWire) => number;

function groupByDueDate(
  tasks: readonly TaskWire[],
  today: string,
  compare: TaskCompare,
): readonly TaskGroup[] {
  const groups = new Map<DueGroupName, TaskWire[]>();
  for (const task of tasks) {
    const name = classifyTask(task, today);
    const group = groups.get(name) ?? [];
    group.push(task);
    groups.set(name, group);
  }
  return dueGroupOrder.flatMap((name) => {
    const groupedTasks = groups.get(name);
    return groupedTasks === undefined ? [] : [{ name, tasks: groupedTasks.sort(compare) }];
  });
}

/**
 * A task can belong to more than one tag group, so keys are collected per task. Named
 * groups sort alphabetically with the catch-all bucket last.
 */
function groupByKeys(
  tasks: readonly TaskWire[],
  keysOf: (task: TaskWire) => readonly string[],
  compare: TaskCompare,
): readonly TaskGroup[] {
  const groups = new Map<string, TaskWire[]>();
  for (const task of tasks) {
    for (const key of keysOf(task)) {
      const group = groups.get(key) ?? [];
      group.push(task);
      groups.set(key, group);
    }
  }
  return [...groups.entries()]
    .sort(([left], [right]) => {
      if (left === NO_TAG) return 1;
      if (right === NO_TAG) return -1;
      return left.localeCompare(right, undefined, { sensitivity: "base" });
    })
    .map(([name, groupedTasks]) => ({ name, tasks: groupedTasks.sort(compare) }));
}

export type DueUrgency = "overdue" | "soon" | "later" | "none";

/** How near a due date is, in the three steps a list needs to colour it by. */
export function dueUrgency(
  due: string | undefined,
  today = localDateKey(new Date()),
): DueUrgency {
  const key = due?.slice(0, 10);
  if (key === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    return "none";
  }
  if (key < today) {
    return "overdue";
  }
  // A week, because that is the horizon a task list is read against.
  return daysBetween(today, key) <= 7 ? "soon" : "later";
}

function daysBetween(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.round((end - start) / 86_400_000);
}

export function formatDueDate(due: string | undefined): string | undefined {
  if (due === undefined) {
    return undefined;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(due);
  if (match === null) {
    return due;
  }
  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

function matchesFilter(task: TaskWire, filter: TaskFilter, today: string): boolean {
  /*
   * Due Today is what is late or landing today. Work that slipped its date belongs here more
   * than anything else does: scoped strictly to the current date, a task that missed its day
   * left the list, and the row went quiet exactly when something had been forgotten.
   */
  if (filter.view === "today") {
    const due = task.due?.slice(0, 10);
    if (task.completed || due === undefined || due > today) return false;
  }
  if (filter.status === "open" && task.completed) {
    return false;
  }
  if (filter.status === "completed" && !task.completed) {
    return false;
  }
  const query = filter.query.trim().toLocaleLowerCase();
  if (query.length === 0) {
    return true;
  }
  return [task.text, task.noteTitle, task.notePath, ...task.tags]
    .join(" ")
    .toLocaleLowerCase()
    .includes(query);
}

function classifyTask(task: TaskWire, today: string): DueGroupName {
  if (task.completed) {
    return "Completed";
  }
  const due = task.due?.slice(0, 10);
  if (due === undefined) {
    return "No due date";
  }
  if (due < today) {
    return "Overdue";
  }
  if (due === today) {
    return "Today";
  }
  return dueUrgency(due, today) === "soon" ? "This week" : "Later";
}

/**
 * Row order within a group. A completed task always sinks below the open ones — the list is
 * read for what is left to do — and a task missing the sorted-on value always sits at the
 * end, whichever direction the sort runs: "no date" is an absence, not a large or small date.
 */
function taskComparator(sortBy: TaskSortKey, direction: TaskSortDirection): TaskCompare {
  const sign = direction === "desc" ? -1 : 1;
  return (left, right) => {
    if (left.completed !== right.completed) {
      return left.completed ? 1 : -1;
    }
    return sortedValueOrder(left, right, sortBy, sign) ||
      (left.due ?? "9999").localeCompare(right.due ?? "9999") ||
      left.text.localeCompare(right.text);
  };
}

function sortedValueOrder(
  left: TaskWire,
  right: TaskWire,
  sortBy: TaskSortKey,
  sign: number,
): number {
  switch (sortBy) {
    case "due":
      return left.due === undefined || right.due === undefined
        ? absentLast(left.due, right.due)
        : sign * left.due.localeCompare(right.due);
    case "created":
      return left.noteCreatedAt === undefined || right.noteCreatedAt === undefined
        ? absentLast(left.noteCreatedAt, right.noteCreatedAt)
        : sign * Math.sign(left.noteCreatedAt - right.noteCreatedAt);
    case "text":
      return sign * left.text.localeCompare(right.text, undefined, { sensitivity: "base" });
  }
}

function absentLast(left: unknown, right: unknown): number {
  return left === right ? 0 : left === undefined ? 1 : -1;
}

function localDateKey(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
