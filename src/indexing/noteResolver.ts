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

export function compareNotes(left: NoteRecord, right: NoteRecord): number {
  return compareText(canonicalPath(left.path), canonicalPath(right.path)) || compareText(left.uri, right.uri);
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
