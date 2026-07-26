import type {
  Backlink,
  IndexSnapshot,
  NoteContext,
  NoteRecord,
  ResolvedLink,
} from "../domain/models";
import { lineNumberAtOffset, scanLines } from "../markdown/lines";
import { compareNotes, createNoteResolver } from "./noteResolver";
import { createWikiReferenceResolver } from "./wikiReferenceResolver";

export { buildLocalGraph, buildWorkspaceGraph } from "./graphProjection";
export type { GraphOptions } from "./graphProjection";

export function buildSnapshot(
  notes: readonly NoteRecord[],
  version = 1,
  indexedAt = Date.now(),
): IndexSnapshot {
  const orderedNotes = Object.freeze([...notes].sort(compareNotes));
  const links: ResolvedLink[] = [];
  const backlinks: Backlink[] = [];
  const tasks: IndexSnapshot["tasks"][number][] = [];
  const resolver = createNoteResolver(orderedNotes);

  for (const note of orderedNotes) {
    const lines = scanLines(note.content);
    for (const link of note.links) {
      const target = resolver.resolve(note.uri, link.target);
      const resolved: ResolvedLink = {
        sourceUri: note.uri,
        link,
        ...(target === undefined ? {} : { targetUri: target.uri }),
      };
      links.push(Object.freeze(resolved));
      if (target !== undefined) {
        backlinks.push(
          Object.freeze({
            sourceUri: note.uri,
            sourceTitle: note.title,
            sourcePath: note.path,
            targetUri: target.uri,
            range: link.range,
            context: lineContext(note.content, link.range.start),
            line: lineNumberAtOffset(lines, link.range.start),
          }),
        );
      }
    }
    for (const task of note.tasks) {
      tasks.push(
        Object.freeze({
          ...task,
          noteUri: note.uri,
          noteTitle: note.title,
          notePath: note.path,
        }),
      );
    }
  }

  backlinks.sort(
    (left, right) =>
      compareText(left.targetUri, right.targetUri) ||
      compareText(left.sourcePath, right.sourcePath) ||
      left.range.start - right.range.start,
  );
  return Object.freeze({
    notes: orderedNotes,
    links: Object.freeze(links),
    backlinks: Object.freeze(backlinks),
    tasks: Object.freeze(tasks),
    version,
    indexedAt,
  });
}

export function resolveWikiTarget(
  snapshotOrNotes: IndexSnapshot | readonly NoteRecord[],
  sourceUri: string,
  target: string,
): NoteRecord | undefined {
  const notes = isSnapshot(snapshotOrNotes) ? snapshotOrNotes.notes : snapshotOrNotes;
  return createNoteResolver(notes).resolve(sourceUri, target);
}

export function getBrokenLinks(snapshot: IndexSnapshot): readonly ResolvedLink[] {
  const resolver = createWikiReferenceResolver(snapshot.notes);
  return Object.freeze(
    snapshot.links.filter(
      ({ sourceUri, link }) => resolver.resolve(sourceUri, link).status !== "resolved",
    ),
  );
}

export function getOrphanNotes(snapshot: IndexSnapshot): readonly NoteRecord[] {
  const connected = new Set<string>();
  for (const link of snapshot.links) {
    if (link.targetUri !== undefined) {
      connected.add(link.sourceUri);
      connected.add(link.targetUri);
    }
  }
  return Object.freeze(snapshot.notes.filter((note) => !connected.has(note.uri)));
}

export function buildNoteContext(
  snapshot: IndexSnapshot,
  uri: string,
): NoteContext | undefined {
  const note = snapshot.notes.find((candidate) => candidate.uri === uri);
  if (note === undefined) {
    return undefined;
  }
  const segments = note.path.split("/").filter((segment) => segment.length > 0);
  return Object.freeze({
    folders: Object.freeze(segments.slice(0, -1)),
    fileName: segments[segments.length - 1] ?? note.fileName,
    tags: note.tags,
    backlinkCount: snapshot.backlinks.filter((backlink) => backlink.targetUri === uri).length,
    outgoingCount: snapshot.links.filter((link) => link.sourceUri === uri).length,
    taskCount: note.tasks.length,
    openTaskCount: note.tasks.filter((task) => !task.completed).length,
  });
}

function lineContext(content: string, offset: number): string {
  let start = Math.min(Math.max(0, offset), content.length);
  let end = start;
  while (start > 0 && content[start - 1] !== "\n" && content[start - 1] !== "\r") start -= 1;
  while (end < content.length && content[end] !== "\n" && content[end] !== "\r") end += 1;
  return content.slice(start, end).trim();
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isSnapshot(value: IndexSnapshot | readonly NoteRecord[]): value is IndexSnapshot {
  return !Array.isArray(value);
}
