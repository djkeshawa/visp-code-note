import type {
  Backlink,
  IndexSnapshot,
  NoteContext,
  NoteOutgoingLinkContext,
  NoteRecord,
  ResolvedLink,
} from "../domain/models";
import { lineNumberAtOffset, scanLines } from "../markdown/lines";
import { mergeTagNames } from "../markdown/tags";
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
      /*
       * A backlink is a mention from somewhere else. `[[#Heading]]` and `[[^block]]` point
       * inside the note being read, and the resolver answers them with that same note, so
       * recording them here made a note appear in its own backlinks list — once per anchor.
       */
      if (target !== undefined && target.uri !== note.uri) {
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
          ...(note.createdAt === undefined ? {} : { noteCreatedAt: note.createdAt }),
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
    // A note that links only to its own headings is still connected to nothing.
    if (link.targetUri !== undefined && link.targetUri !== link.sourceUri) {
      connected.add(link.sourceUri);
      connected.add(link.targetUri);
    }
  }
  return Object.freeze(snapshot.notes.filter((note) => !connected.has(note.uri)));
}

/**
 * The inspector lists mentions, not every mention. A note everything points at would
 * otherwise put its whole in-link table on the wire on every keystroke, and no one reads
 * past the first screenful of a 300px column anyway — the count above the list stays exact.
 */
const INSPECTOR_BACKLINK_LIMIT = 50;
const INSPECTOR_LINK_LIMIT = 50;

export function buildNoteContext(
  snapshot: IndexSnapshot,
  uri: string,
): NoteContext | undefined {
  const note = snapshot.notes.find((candidate) => candidate.uri === uri);
  if (note === undefined) {
    return undefined;
  }
  const segments = note.path.split("/").filter((segment) => segment.length > 0);
  const declared = note.frontmatter?.tags;
  const incoming = snapshot.backlinks.filter((backlink) => backlink.targetUri === uri);
  const destinations = dedupeLinks(snapshot.links.filter((link) => link.sourceUri === uri));
  return Object.freeze({
    folders: Object.freeze(segments.slice(0, -1)),
    fileName: segments[segments.length - 1] ?? note.fileName,
    tags: note.tags,
    frontmatterTags: mergeTagNames(
      typeof declared === "string" ? [declared] : declared ?? [],
    ),
    backlinkCount: incoming.length,
    // Destinations, not link occurrences, so the count agrees with the list it heads.
    outgoingCount: destinations.length,
    taskCount: note.tasks.length,
    openTaskCount: note.tasks.filter((task) => !task.completed).length,
    backlinks: Object.freeze(
      incoming.slice(0, INSPECTOR_BACKLINK_LIMIT).map((backlink) =>
        Object.freeze({
          uri: backlink.sourceUri,
          title: backlink.sourceTitle,
          line: backlink.line,
          start: backlink.range.start,
          context: backlink.context,
        })),
    ),
    linksOut: Object.freeze(destinations.slice(0, INSPECTOR_LINK_LIMIT)),
  });
}

/**
 * The destinations a note reaches, in the order it reaches them.
 *
 * The same note linked three times is one destination, not three. A link with no target at
 * all — `[[#Heading]]` or `[[^block]]`, which point inside the note being read — is not a
 * destination either: it resolves to the note itself, and listing it produced a chip with no
 * label that threw "the wiki-link target is invalid" when clicked, because there is no note
 * name to open.
 *
 * `resolved` asks only whether the target note exists. A link into a heading or block that
 * does not exist is a different failure — it is reported by diagnostics and by Find Broken
 * Links, which resolve the whole reference — and answering it here would mean building a
 * reference resolver over every note on each call, which this runs far too often for.
 */
function dedupeLinks(links: readonly ResolvedLink[]): NoteOutgoingLinkContext[] {
  const seen = new Set<string>();
  const outgoing: NoteOutgoingLinkContext[] = [];
  for (const { link, targetUri } of links) {
    const target = link.target.trim();
    if (target === "") continue;
    const key = target.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    outgoing.push(
      Object.freeze({
        label: link.alias ?? target,
        target,
        resolved: targetUri !== undefined,
      }),
    );
  }
  return outgoing;
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
