import type { TaskWire } from "../contracts.js";

export type TaskStatusFilter = "open" | "all" | "completed";
export type TaskGrouping = "due" | "note" | "tag";
export type DueGroupName = "Overdue" | "Today" | "Upcoming" | "No due date" | "Completed";

export const TASK_GROUPINGS: readonly TaskGrouping[] = ["due", "note", "tag"];

export interface TaskFilter {
  readonly query: string;
  readonly status: TaskStatusFilter;
  readonly view: "all" | "today";
  /** Defaults to due-date buckets, the order most task lists are read in. */
  readonly groupBy?: TaskGrouping;
}

export interface TaskGroup {
  readonly name: string;
  readonly tasks: readonly TaskWire[];
}

const NO_TAG = "No tag";

const dueGroupOrder: readonly DueGroupName[] = [
  "Overdue",
  "Today",
  "Upcoming",
  "No due date",
  "Completed",
];

export function parseTaskGrouping(value: unknown): TaskGrouping {
  return TASK_GROUPINGS.find((grouping) => grouping === value) ?? "due";
}

export function groupTasks(
  tasks: readonly TaskWire[],
  filter: TaskFilter,
  today = localDateKey(new Date()),
): readonly TaskGroup[] {
  const visible = tasks.filter((task) => matchesFilter(task, filter, today));
  switch (filter.groupBy ?? "due") {
    case "note":
      return groupByKeys(visible, (task) => [task.noteTitle]);
    case "tag":
      return groupByKeys(
        visible,
        (task) => task.tags.length === 0 ? [NO_TAG] : task.tags.map((tag) => `#${tag}`),
      );
    case "due":
      return groupByDueDate(visible, today);
  }
}

function groupByDueDate(tasks: readonly TaskWire[], today: string): readonly TaskGroup[] {
  const groups = new Map<DueGroupName, TaskWire[]>();
  for (const task of tasks) {
    const name = classifyTask(task, today);
    const group = groups.get(name) ?? [];
    group.push(task);
    groups.set(name, group);
  }
  return dueGroupOrder.flatMap((name) => {
    const groupedTasks = groups.get(name);
    return groupedTasks === undefined ? [] : [{ name, tasks: groupedTasks.sort(compareTasks) }];
  });
}

/**
 * A task can belong to more than one tag group, so keys are collected per task. Named
 * groups sort alphabetically with the catch-all bucket last.
 */
function groupByKeys(
  tasks: readonly TaskWire[],
  keysOf: (task: TaskWire) => readonly string[],
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
    .map(([name, groupedTasks]) => ({ name, tasks: groupedTasks.sort(compareTasks) }));
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
  if (filter.view === "today" && (task.completed || task.due?.slice(0, 10) !== today)) {
    return false;
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
  return due === today ? "Today" : "Upcoming";
}

function compareTasks(left: TaskWire, right: TaskWire): number {
  if (left.completed !== right.completed) {
    return left.completed ? 1 : -1;
  }
  return (left.due ?? "9999").localeCompare(right.due ?? "9999") ||
    left.text.localeCompare(right.text);
}

function localDateKey(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
