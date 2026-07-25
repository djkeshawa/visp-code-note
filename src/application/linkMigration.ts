import type { IndexSnapshot, NoteRecord, OffsetRange, ResolvedLink, WikiLink } from "../domain/models";
import { posix } from "node:path";
import { encodeWikiTarget, normalizeNoteKey, normalizeWikiTarget } from "../domain/normalization";
import { createNoteResolver } from "../indexing/noteResolver";

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
