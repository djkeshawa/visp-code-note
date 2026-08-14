import type { IndexSnapshot, NoteRecord, OffsetRange, ResolvedLink, WikiLink } from "../domain/models";
import { posix } from "node:path";
import { encodeWikiTarget, normalizeNoteKey, normalizeWikiTarget } from "../domain/normalization";
import { createNoteResolver, createWikiTargetPlanner } from "../indexing/noteResolver";

export interface LinkReplacement {
  readonly uri: string;
  readonly range: OffsetRange;
  readonly expectedText: string;
  readonly text: string;
}

export function planLinkMigration(
  snapshot: IndexSnapshot,
  renamedNote: NoteRecord,
  nextTitle: string,
  nextPath?: string,
): readonly LinkReplacement[] {
  const notesByUri = new Map(snapshot.notes.map((note) => [note.uri, note]));
  return snapshot.links
    .filter((resolved) => resolved.targetUri === renamedNote.uri)
    .map((resolved) => {
      const source = notesByUri.get(resolved.sourceUri);
      const sourcePath = resolved.sourceUri === renamedNote.uri && nextPath
        ? nextPath
        : source?.path;
      const target = nextPath && sourcePath
        ? relativeWikiTarget(sourcePath, nextPath)
        : encodeWikiTarget(nextTitle);
      return {
        uri: resolved.sourceUri,
        range: resolved.link.range,
        expectedText: resolved.link.raw,
        text: rewriteWikiLink(resolved.link, target),
      };
    });
}

export function planPathLinkMigration(
  snapshot: IndexSnapshot,
  renamedNote: NoteRecord,
  nextTitle: string,
  nextPath?: string,
): readonly LinkReplacement[] {
  const aliasKeys = new Set(
    [renamedNote.title, ...renamedNote.aliases].map((value) => normalizeNoteKey(value)),
  );
  const renamedProjection: NoteRecord = {
    ...renamedNote,
    title: nextTitle,
    path: nextPath ?? renamedNote.path,
    aliases: Object.freeze([...renamedNote.aliases, renamedNote.title]),
  };
  const postRenameResolver = createNoteResolver(
    snapshot.notes.map((note) => note.uri === renamedNote.uri ? renamedProjection : note),
  );
  const safeLinks = new Set(
    snapshot.links
      .filter((resolved) =>
        resolved.targetUri === renamedNote.uri &&
        aliasKeys.has(normalizeWikiTarget(resolved.link.target)) &&
        postRenameResolver.resolve(resolved.sourceUri, resolved.link.target)?.uri === renamedNote.uri,
      )
      .map(linkIdentity),
  );
  return planLinkMigration(snapshot, renamedNote, nextTitle, nextPath)
    .filter((replacement) => !safeLinks.has(replacementIdentity(replacement)));
}

/**
 * One file's record either side of a file operation.
 *
 * `previous` is absent for a file that is becoming a note — a `.txt` renamed to `.md`. `next` is
 * absent for one that stops being one — a note renamed to `.txt`, or dragged into an excluded
 * folder. Both together describe a note that moved or was renamed.
 */
export interface NoteRelocation {
  readonly previous?: NoteRecord;
  readonly next?: NoteRecord;
}

/**
 * The rewrites a set of renames needs, and the notes those rewrites are only correct because of.
 *
 * `dependsOn` exists because a plan can be perfectly correct about the link text it is rewriting
 * and wrong about the workspace it resolved that text against. The index is read on a debounce
 * and rebuilt in the background, so it can be behind on file *layout* as easily as on file
 * *text* — and a rewrite that pins a link to a path is a statement that the file at that path
 * exists. These are the notes whose names were written down; the caller, which is the only side
 * that can touch the disk, is expected to confirm they are still there before writing anything.
 */
export interface RelocationPlan {
  readonly replacements: readonly LinkReplacement[];
  readonly dependsOn: readonly NoteRecord[];
}

/**
 * Rewrites the links a set of file renames would otherwise change the meaning of.
 *
 * The rule is one sentence: renaming files never changes what a link points at. Every link in
 * the vault is resolved against the workspace as it will be once the renames land, and the ones
 * that would land somewhere else — or nowhere — are rewritten to name the note they mean today.
 * Everything else is left exactly as the user typed it, which is why a note that carries its own
 * `# Title` can be moved between folders without a single `[[link]]` being touched.
 *
 * Stating it that way is what makes the awkward cases fall out rather than each needing its own
 * branch: a rename that only changes case moves no link, because note names are matched without
 * case; two notes renamed at once see each other's new names, because there is one resolver over
 * one post-rename workspace; and a new name that collides with an existing note's title re-pins
 * the *other* note's incoming links to a path, because those are the links whose meaning the
 * rename would otherwise have quietly stolen.
 *
 * A link whose target is leaving the index is left alone: there is no name that would still
 * reach it, and the text the user wrote at least records what they meant. The same holds for a
 * note the workspace has no name for at all — one renamed to `.md`, which leaves no stem to
 * write down. An unverified guess there does not degrade the link, it destroys it.
 */
export function planRelocationMigration(
  snapshot: IndexSnapshot,
  relocations: readonly NoteRelocation[],
): RelocationPlan {
  const moved = new Map<string, NoteRecord | undefined>();
  const arrivals: NoteRecord[] = [];
  for (const relocation of relocations) {
    if (relocation.previous) moved.set(relocation.previous.uri, relocation.next);
    else if (relocation.next) arrivals.push(relocation.next);
  }
  if (moved.size === 0 && arrivals.length === 0) return { replacements: [], dependsOn: [] };

  const currentNotes = new Map(snapshot.notes.map((note) => [note.uri, note]));
  const noteAfter = (uri: string): NoteRecord | undefined =>
    moved.has(uri) ? moved.get(uri) : currentNotes.get(uri);
  const nextNotes = [
    ...snapshot.notes.flatMap((note) => {
      const next = noteAfter(note.uri);
      return next ? [next] : [];
    }),
    ...arrivals,
  ];

  const resolver = createNoteResolver(nextNotes);
  const planner = createWikiTargetPlanner(nextNotes);
  const replacements: LinkReplacement[] = [];
  const dependsOn = new Map<string, NoteRecord>();
  for (const resolved of snapshot.links) {
    if (resolved.targetUri === undefined) continue;
    const intended = noteAfter(resolved.targetUri);
    // A link is read relative to the file it sits in, so the source's own new home matters too.
    const source = noteAfter(resolved.sourceUri);
    if (intended === undefined || source === undefined) continue;
    if (resolver.resolve(source.uri, resolved.link.target)?.uri === intended.uri) continue;
    const target = planner.reachingTargetFor(source.uri, intended);
    // Nothing reaches the note any more. Leaving the link as written says what the user meant.
    if (target === undefined) continue;
    const text = rewriteWikiLink(resolved.link, target);
    if (text === resolved.link.raw) continue;
    replacements.push({
      uri: resolved.sourceUri,
      range: resolved.link.range,
      expectedText: resolved.link.raw,
      text,
    });
    dependsOn.set(intended.uri, intended);
  }
  return { replacements, dependsOn: [...dependsOn.values()] };
}

export function rewriteWikiLink(link: WikiLink, nextTarget: string): string {
  const anchor = `${link.heading ? `#${link.heading}` : ""}${link.blockId ? `^${link.blockId}` : ""}`;
  const alias = link.alias ? `|${link.alias}` : "";
  return `[[${nextTarget}${anchor}${alias}]]`;
}

export function groupLinkReplacements(
  replacements: readonly LinkReplacement[],
): ReadonlyMap<string, readonly LinkReplacement[]> {
  const grouped = new Map<string, LinkReplacement[]>();
  for (const replacement of replacements) {
    const items = grouped.get(replacement.uri) ?? [];
    items.push(replacement);
    grouped.set(replacement.uri, items);
  }
  return grouped;
}

function relativeWikiTarget(sourcePath: string, targetPath: string): string {
  const sourceDirectory = posix.dirname(sourcePath.replace(/\\/g, "/"));
  const targetWithoutExtension = targetPath.replace(/\\/g, "/").replace(/\.md$/i, "");
  const relative = posix.relative(sourceDirectory, targetWithoutExtension)
    || posix.basename(targetWithoutExtension);
  return encodeWikiTarget(relative);
}

function linkIdentity(link: ResolvedLink): string {
  return `${link.sourceUri}:${link.link.range.start}:${link.link.range.end}`;
}

function replacementIdentity(replacement: LinkReplacement): string {
  return `${replacement.uri}:${replacement.range.start}:${replacement.range.end}`;
}
