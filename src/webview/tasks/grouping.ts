import type { TaskWire } from "../contracts.js";

export type TaskStatusFilter = "open" | "all" | "completed";
export type TaskGroupName = "Overdue" | "Today" | "Upcoming" | "No due date" | "Completed";

export interface TaskFilter {
  readonly query: string;
  readonly status: TaskStatusFilter;
  readonly view: "all" | "today";
}

export interface TaskGroup {
  readonly name: TaskGroupName;
  readonly tasks: readonly TaskWire[];
}

const groupOrder: readonly TaskGroupName[] = ["Overdue", "Today", "Upcoming", "No due date", "Completed"];

export function groupTasks(
  tasks: readonly TaskWire[],
  filter: TaskFilter,
  today = localDateKey(new Date()),
): readonly TaskGroup[] {
  const groups = new Map<TaskGroupName, TaskWire[]>();
  for (const task of tasks) {
    if (!matchesFilter(task, filter, today)) {
      continue;
    }
    const name = classifyTask(task, today);
    const group = groups.get(name) ?? [];
    group.push(task);
    groups.set(name, group);
  }
  return groupOrder.flatMap((name) => {
    const groupedTasks = groups.get(name);
    if (groupedTasks === undefined) {
      return [];
    }
    return [{ name, tasks: groupedTasks.sort(compareTasks) }];
  });
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

function classifyTask(task: TaskWire, today: string): TaskGroupName {
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
  return (left.due ?? "9999").localeCompare(right.due ?? "9999") || left.text.localeCompare(right.text);
}

function localDateKey(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
