import type { IndexSnapshot, NoteRecord } from "../../domain/models";
import { getBrokenLinks, getOrphanNotes } from "../../indexing/projections";

export type SectionId = "notes" | "smart" | "tags";
export type SmartViewId = "tasks" | "due" | "graph" | "broken" | "orphans";

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

function brokenLinkCount(snapshot: IndexSnapshot): number {
  return getBrokenLinks(snapshot).length;
}

function dueTodayCount(snapshot: IndexSnapshot): number {
  const now = new Date();
  const today = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
  return snapshot.tasks.filter((task) => !task.completed && task.due === today).length;
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
