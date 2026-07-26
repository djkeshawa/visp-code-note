import type { IndexSnapshot, NoteRecord } from "../../domain/models";
import { getBrokenLinks, getOrphanNotes } from "../../indexing/projections";

export type SectionId = "notes" | "smart" | "tags";
export type SmartViewId = "tasks" | "due" | "graph" | "broken" | "orphans";

export type ExplorerTask = IndexSnapshot["tasks"][number];

export type ExplorerNode =
  | { readonly kind: "section"; readonly id: SectionId; readonly label: string }
  | { readonly kind: "folder"; readonly path: string; readonly label: string }
  | { readonly kind: "note"; readonly note: NoteRecord }
  | {
      readonly kind: "smart";
      readonly id: SmartViewId;
      readonly label: string;
      readonly count?: number;
    }
  | { readonly kind: "task"; readonly task: ExplorerTask }
  | { readonly kind: "tag"; readonly tag: string; readonly count: number }
  | { readonly kind: "status" };

export const ROOT_NODES: readonly ExplorerNode[] = [
  { kind: "section", id: "notes", label: "Notes" },
  { kind: "section", id: "smart", label: "Smart Views" },
  { kind: "section", id: "tags", label: "Tags" },
  { kind: "status" },
];

export function noteChildren(
  snapshot: IndexSnapshot,
  parentPath = "",
): readonly ExplorerNode[] {
  const folders = new Set<string>();
  const notes: ExplorerNode[] = [];
  const prefix = parentPath ? `${parentPath}/` : "";

  for (const note of snapshot.notes) {
    if (!note.path.startsWith(prefix)) {
      continue;
    }
    const remainder = note.path.slice(prefix.length);
    const separator = remainder.indexOf("/");
    if (separator === -1) {
      notes.push({ kind: "note", note });
    } else {
      folders.add(remainder.slice(0, separator));
    }
  }

  const folderNodes: ExplorerNode[] = [...folders]
    .sort(compareText)
    .map((label) => ({ kind: "folder", label, path: `${prefix}${label}` }));
  return [...folderNodes, ...notes.sort(compareNoteNodes)];
}

export function smartViews(snapshot: IndexSnapshot): readonly ExplorerNode[] {
  return [
    { kind: "smart", id: "tasks", label: "All Tasks", count: snapshot.tasks.length },
    { kind: "smart", id: "due", label: "Due Today", count: dueTodayCount(snapshot) },
    { kind: "smart", id: "graph", label: "Knowledge Graph" },
    { kind: "smart", id: "broken", label: "Broken Links", count: brokenLinkCount(snapshot) },
    { kind: "smart", id: "orphans", label: "Orphan Notes", count: orphanNotes(snapshot).length },
  ];
}

export function tagNodes(snapshot: IndexSnapshot): readonly ExplorerNode[] {
  const counts = new Map<string, { label: string; count: number }>();
  for (const note of snapshot.notes) {
    for (const tag of note.tags) {
      const key = tag.toLocaleLowerCase();
      const current = counts.get(key);
      counts.set(key, { label: current?.label ?? tag, count: (current?.count ?? 0) + 1 });
    }
  }
  return [...counts.values()]
    .sort((left, right) => compareText(left.label, right.label))
    .map(({ label, count }) => ({ kind: "tag", tag: label, count }));
}

export function notesWithTag(snapshot: IndexSnapshot, tag: string): readonly ExplorerNode[] {
  const key = tag.toLocaleLowerCase();
  return snapshot.notes
    .filter((note) => note.tags.some((candidate) => candidate.toLocaleLowerCase() === key))
    .map((note) => ({ kind: "note" as const, note }))
    .sort(compareNoteNodes);
}

export function orphanNotes(snapshot: IndexSnapshot): readonly ExplorerNode[] {
  return getOrphanNotes(snapshot)
    .map((note) => ({ kind: "note" as const, note }))
    .sort(compareNoteNodes);
}

/**
 * Tasks appear directly in the tree so they can be completed with the item checkbox,
 * without opening the note or the Tasks view first.
 */
export function taskNodes(
  snapshot: IndexSnapshot,
  filter: "all" | "due",
  today = todayStamp(),
): readonly ExplorerNode[] {
  const tasks = filter === "due"
    ? snapshot.tasks.filter((task) => isDueToday(task, today))
    : snapshot.tasks;
  return [...tasks]
    .sort(compareTasks)
    .map((task) => ({ kind: "task" as const, task }));
}

/**
 * Shared by the Due Today children and its badge count so the two can never disagree
 * about what the view contains. Overdue work stays discoverable under All Tasks, which
 * groups by due date with Overdue first.
 */
function isDueToday(task: ExplorerTask, today: string): boolean {
  return !task.completed && task.due?.slice(0, 10) === today;
}

export function todayStamp(now = new Date()): string {
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

function compareTasks(left: ExplorerTask, right: ExplorerTask): number {
  if (left.completed !== right.completed) {
    return left.completed ? 1 : -1;
  }
  // Dated work sorts ahead of undated work, earliest first.
  if (left.due !== right.due) {
    if (left.due === undefined) return 1;
    if (right.due === undefined) return -1;
    return compareText(left.due, right.due);
  }
  return compareText(left.noteTitle, right.noteTitle) || left.line - right.line;
}

function brokenLinkCount(snapshot: IndexSnapshot): number {
  return getBrokenLinks(snapshot).length;
}

function dueTodayCount(snapshot: IndexSnapshot, today = todayStamp()): number {
  return snapshot.tasks.filter((task) => isDueToday(task, today)).length;
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, undefined, { sensitivity: "base" });
}

function compareNoteNodes(left: ExplorerNode, right: ExplorerNode): number {
  if (left.kind !== "note" || right.kind !== "note") {
    return 0;
  }
  return compareText(left.note.title, right.note.title);
}
