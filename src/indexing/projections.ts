import type {
  Backlink,
  IndexSnapshot,
  NoteContext,
  NoteOutgoingLinkContext,
  NoteRecord,
  ResolvedLink,
  SkippedNote,
} from "../domain/models";
import { mergeTagNames } from "../markdown/tags";
import { compareNotes, noteResolverFor } from "./noteResolver";
import { createNoteProjector } from "./noteProjection";
import type { NoteProjector } from "./noteProjection";
import { wikiReferenceResolverFor } from "./wikiReferenceResolver";

export { buildLocalGraph, buildWorkspaceGraph } from "./graphProjection";
export type { GraphOptions } from "./graphProjection";
export { createNoteProjector } from "./noteProjection";
export type { NoteProjector, NoteProjectorOptions } from "./noteProjection";

/**
 * The whole workspace as the views read it.
 *
 * Pass the same `projector` across commits to keep the per-note work that a one-file save did
 * not invalidate; leaving it out projects the vault from scratch, which is what a caller
 * building a one-off snapshot wants.
 *
 * `skippedOversized` is carried through untouched apart from being put in path order. It takes
 * no part in the projection and never will: these are files nothing has read, so there is no
 * title, no alias and no link text to resolve anything against, and letting one into `notes`
 * as a stub would put a name back into the resolvable name-space with nothing behind it.
 */
export function buildSnapshot(
  notes: readonly NoteRecord[],
  version = 1,
  indexedAt = Date.now(),
  projector: NoteProjector = createNoteProjector(),
  skippedOversized: readonly SkippedNote[] = [],
): IndexSnapshot {
  const orderedNotes = Object.freeze([...notes].sort(compareNotes));
  const projections = projector.project(orderedNotes);
  const links: ResolvedLink[] = [];
  const tasks: IndexSnapshot["tasks"][number][] = [];
  /*
   * Grouped by target on the way in rather than sorted in one pass at the end.
   *
   * The order is the same either way — target, then the path of the note doing the mentioning,
   * then where in that note the mention sits — but a vault's mentions nearly all belong to
   * different targets, so sorting them together compares pairs that never needed comparing.
   * Collecting and sorting 28,000 mentions in one pass measured 27ms at 2,000 notes against
   * 15ms grouped, and 92ms against 39ms at 4,000. Which mentions a reader sees depends on this
   * order — the inspector shows a note's first fifty — so `projections.test.ts` pins it.
   */
  const byTarget = new Map<string, Backlink[]>();

  for (const projection of projections) {
    for (const link of projection.links) links.push(link);
    for (const task of projection.tasks) tasks.push(task);
    for (const backlink of projection.backlinks) {
      const group = byTarget.get(backlink.targetUri);
      if (group === undefined) byTarget.set(backlink.targetUri, [backlink]);
      else group.push(backlink);
    }
  }

  const backlinks: Backlink[] = [];
  for (const targetUri of [...byTarget.keys()].sort(compareText)) {
    const group = byTarget.get(targetUri) ?? [];
    group.sort((left, right) =>
      compareText(left.sourcePath, right.sourcePath) || left.range.start - right.range.start);
    for (const backlink of group) backlinks.push(backlink);
  }

  return Object.freeze({
    notes: orderedNotes,
    links: Object.freeze(links),
    backlinks: Object.freeze(backlinks),
    tasks: Object.freeze(tasks),
    skippedOversized: Object.freeze(
      [...skippedOversized].sort((left, right) => compareText(left.path, right.path)),
    ),
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
  return noteResolverFor(notes).resolve(sourceUri, target);
}

export function getBrokenLinks(snapshot: IndexSnapshot): readonly ResolvedLink[] {
  const resolver = wikiReferenceResolverFor(snapshot.notes);
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

/*
 * One context per note per commit.
 *
 * A context is a linear find over every note and two filters over every link and every
 * backlink in the workspace — 1.4ms at 2,000 notes — and the note editor asked for one on
 * every keystroke, where the answer cannot have moved: nothing here reads the draft, only
 * the snapshot it was handed. Keyed on the snapshot object rather than its version number,
 * because `buildSnapshot` defaults to version 1 and two unrelated one-off snapshots would
 * otherwise answer for each other.
 */
const contexts = new WeakMap<IndexSnapshot, Map<string, NoteContext | undefined>>();

export function buildNoteContext(
  snapshot: IndexSnapshot,
  uri: string,
): NoteContext | undefined {
  let byUri = contexts.get(snapshot);
  if (byUri === undefined) {
    byUri = new Map();
    contexts.set(snapshot, byUri);
  } else if (byUri.has(uri)) {
    return byUri.get(uri);
  }
  const context = computeNoteContext(snapshot, uri);
  byUri.set(uri, context);
  return context;
}

function computeNoteContext(
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

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isSnapshot(value: IndexSnapshot | readonly NoteRecord[]): value is IndexSnapshot {
  return !Array.isArray(value);
}
