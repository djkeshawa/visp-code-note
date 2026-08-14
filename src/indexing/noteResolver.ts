import type { NoteRecord, SkippedNote } from "../domain/models";
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
  /**
   * The name to write for a link to this note, falling back to its path from the workspace root
   * when nothing reaches it. For inserting a link, where a best guess beats writing nothing.
   */
  targetFor(sourceUri: string | undefined, targetNote: NoteRecord): string;
  /**
   * The same name, but only when it demonstrably resolves back to the note.
   *
   * `undefined` means no name this workspace can write down reaches it — a note whose file name
   * has no stem has no title and no usable path, and two notes whose paths differ only in case
   * cannot both be named, because names are matched without case. Rewriting a link to an
   * unverified guess is how `[[Target]]` became `[[]]`, so the migration asks this instead.
   */
  reachingTargetFor(sourceUri: string | undefined, targetNote: NoteRecord): string | undefined;
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
  const rootPath = (targetNote: NoteRecord): string => targetNote.path.replace(/\.md$/i, "");
  /* Every name that could reach the note, nearest to the reader first. */
  const candidates = (sourceUri: string | undefined, targetNote: NoteRecord): readonly string[] => {
    const targetPath = rootPath(targetNote);
    const source = sourceUri ? byUri.get(sourceUri) : undefined;
    const relativePath = source
      ? posix.relative(posix.dirname(source.path.replace(/\\/g, "/")), targetPath)
        || posix.basename(targetPath)
      : targetPath;
    return [
      encodeWikiTarget(targetNote.title),
      encodeWikiTarget(relativePath),
      encodeWikiTarget(targetPath),
    ];
  };
  const reaching = (
    sourceUri: string | undefined,
    targetNote: NoteRecord,
  ): string | undefined => candidates(sourceUri, targetNote).find(
    (candidate) => resolver.resolve(sourceUri ?? "", candidate)?.uri === targetNote.uri,
  );
  return {
    targetFor(sourceUri, targetNote) {
      return reaching(sourceUri, targetNote) ?? encodeWikiTarget(rootPath(targetNote));
    },
    reachingTargetFor: reaching,
  };
}

/**
 * The file the size limit skipped that this target names, if the target names one.
 *
 * Asked only after `createNoteResolver` has answered with nothing, so that a note which is
 * actually indexed always wins. The point is the sentence the reader is shown: a link to a
 * note past `vispNotes.maxNoteSizeKB` used to be reported unresolved and then offered "Create
 * Note" — an offer to overwrite the file it could not find, which is the worst thing this
 * could have done with a note it had decided not to read.
 *
 * Only the names a file that has never been opened can be said to have: its path, whole or
 * from the linking note, and any suffix of it — which is where the bare file name comes from,
 * a file at the workspace root being answered by the whole-path rule instead. There is no
 * title and no alias, because reading them is exactly what the limit prevented, so
 * `[[My Enormous Note]]` against `notes/enormous.md` finds nothing here and the reader is told
 * the target does not exist — still true of every name anything in the workspace knows.
 *
 * Linear over the skipped files rather than indexed like the resolver: this runs once per
 * click on an unresolved link, over a list that is almost always empty and never long.
 */
export function findSkippedNote(
  skipped: readonly SkippedNote[],
  sourcePath: string | undefined,
  target: string,
): SkippedNote | undefined {
  const trimmed = target.trim();
  if (trimmed === "" || skipped.length === 0) return undefined;
  const targetKey = canonicalTarget(trimmed);
  const sourceDirectory = directoryName(canonicalPath(sourcePath ?? ""));
  const relativeKey = canonicalPath(`${sourceDirectory}/${trimmed}`);
  // The resolver's own order, minus the name kinds an unread file cannot have.
  const rules: readonly ((entry: SkippedNote) => boolean)[] = [
    (entry) => canonicalPath(entry.path) === relativeKey,
    (entry) => canonicalPath(entry.path) === targetKey,
    (entry) => pathSuffixes(canonicalPath(entry.path)).includes(targetKey),
  ];
  // Path order, so two skipped files answering to one name are decided the way notes are.
  const ordered = [...skipped].sort((left, right) =>
    compareText(canonicalPath(left.path), canonicalPath(right.path)));
  for (const rule of rules) {
    const found = ordered.find((entry) => targetKey !== "" && rule(entry));
    if (found !== undefined) return found;
  }
  return undefined;
}

function pathSuffixes(path: string): readonly string[] {
  const segments = path.split("/");
  const suffixes: string[] = [];
  for (let index = 1; index < segments.length; index += 1) {
    suffixes.push(segments.slice(index).join("/"));
  }
  return suffixes;
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
