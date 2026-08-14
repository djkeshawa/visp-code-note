import type { NoteRecord } from "../domain/models";
import { posix } from "node:path";
import {
  encodeWikiTarget,
  normalizeNoteKey,
  normalizeWikiTarget,
  noteStem,
} from "../domain/normalization";

export interface NoteResolver {
  resolve(sourceUri: string, target: string): NoteRecord | undefined;
}

export interface WikiTargetPlanner {
  targetFor(sourceUri: string | undefined, targetNote: NoteRecord): string;
}

/*
 * One resolver per index commit, for callers holding a snapshot's notes.
 *
 * Building one indexes every note by path, by title, by alias, by stem and by every path
 * suffix — 10ms over 2,000 notes on this machine. The index publishes a fresh frozen array on
 * every commit and never mutates one, so the array is itself the statement that a resolver is
 * still true, and a WeakMap lets it go with the snapshot rather than pinning the last vault in
 * memory. The records it answers with are always the ones the caller is holding.
 */
const resolvers = new WeakMap<readonly NoteRecord[], NoteResolver>();

export function noteResolverFor(notes: readonly NoteRecord[]): NoteResolver {
  let resolver = resolvers.get(notes);
  if (resolver === undefined) {
    resolver = createNoteResolver(notes);
    resolvers.set(notes, resolver);
  }
  return resolver;
}

export function createNoteResolver(notes: readonly NoteRecord[]): NoteResolver {
  const byUri = new Map(notes.map((note) => [note.uri, note]));
  const byPath = new Map<string, NoteRecord>();
  const byTitle = new Map<string, NoteRecord>();
  const byAlias = new Map<string, NoteRecord>();
  const byStem = new Map<string, NoteRecord>();
  const bySuffix = new Map<string, NoteRecord>();

  for (const note of notes) {
    const path = canonicalPath(note.path);
    addBest(byPath, path, note);
    addBest(byTitle, noteKey(note.title), note);
    addBest(byStem, noteKey(noteStem(note.path)), note);
    for (const alias of note.aliases) {
      addBest(byAlias, noteKey(alias), note);
    }
    const segments = path.split("/");
    for (let index = 1; index < segments.length; index += 1) {
      addBest(bySuffix, segments.slice(index).join("/"), note);
    }
  }

  return {
    resolve(sourceUri, target) {
      const source = byUri.get(sourceUri);
      const trimmed = target.trim();
      if (trimmed === "") {
        return source;
      }
      const targetKey = canonicalTarget(trimmed);
      const sourceDirectory = source ? directoryName(canonicalPath(source.path)) : "";
      const relativeKey = canonicalPath(`${sourceDirectory}/${trimmed}`);
      return byPath.get(relativeKey)
        ?? byPath.get(targetKey)
        ?? byTitle.get(targetKey)
        ?? byAlias.get(targetKey)
        ?? byStem.get(targetKey)
        ?? bySuffix.get(targetKey);
    },
  };
}

/*
 * Canonical paths, remembered beside the record they belong to.
 *
 * `compareNotes` orders every note list in the extension, and it canonicalised both sides on
 * every single comparison — a backslash replace, an extension strip, a trim, a locale
 * lowercase and a segment walk, run about 44,000 times to sort 2,000 notes. That measured
 * 36ms of a 60ms commit, more than the projection it was ordering. A record's path never
 * changes; a changed path is a new record.
 */
const canonicalPaths = new WeakMap<NoteRecord, string>();

function notePathKey(note: NoteRecord): string {
  let key = canonicalPaths.get(note);
  if (key === undefined) {
    key = canonicalPath(note.path);
    canonicalPaths.set(note, key);
  }
  return key;
}

export function compareNotes(left: NoteRecord, right: NoteRecord): number {
  return compareText(notePathKey(left), notePathKey(right)) || compareText(left.uri, right.uri);
}

export function wikiTargetForNote(
  notes: readonly NoteRecord[],
  sourceUri: string | undefined,
  targetNote: NoteRecord,
): string {
  return createWikiTargetPlanner(notes).targetFor(sourceUri, targetNote);
}

export function createWikiTargetPlanner(notes: readonly NoteRecord[]): WikiTargetPlanner {
  const resolver = createNoteResolver(notes);
  const byUri = new Map(notes.map((note) => [note.uri, note]));
  return {
    targetFor(sourceUri, targetNote) {
      const titleTarget = encodeWikiTarget(targetNote.title);
      if (resolver.resolve(sourceUri ?? "", titleTarget)?.uri === targetNote.uri) {
        return titleTarget;
      }

      const targetPath = targetNote.path.replace(/\.md$/i, "");
      const source = sourceUri ? byUri.get(sourceUri) : undefined;
      const relativePath = source
        ? posix.relative(posix.dirname(source.path.replace(/\\/g, "/")), targetPath)
          || posix.basename(targetPath)
        : targetPath;
      const pathTarget = encodeWikiTarget(relativePath);
      return resolver.resolve(sourceUri ?? "", pathTarget)?.uri === targetNote.uri
        ? pathTarget
        : encodeWikiTarget(targetPath);
    },
  };
}

function addBest(map: Map<string, NoteRecord>, key: string, note: NoteRecord): void {
  const current = map.get(key);
  if (key !== "" && (!current || compareNotes(note, current) < 0)) {
    map.set(key, note);
  }
}

function directoryName(path: string): string {
  const separator = path.lastIndexOf("/");
  return separator === -1 ? "" : path.slice(0, separator);
}

function canonicalPath(value: string): string {
  return canonicalSegments(noteKey(value));
}

function canonicalTarget(value: string): string {
  return canonicalSegments(normalizeWikiTarget(value));
}

function canonicalSegments(value: string): string {
  const segments: string[] = [];
  for (const segment of value.replace(/^\/+/, "").split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") segments.pop();
    else segments.push(segment);
  }
  return segments.join("/");
}

function noteKey(value: string): string {
  return normalizeNoteKey(value);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
