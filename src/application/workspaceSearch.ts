import type { IndexSnapshot, NoteRecord } from "../domain/models";
import {
  createSearchRequest,
  lowercasePreservingLength,
  lowerValueOffset,
  selectSearchMatch,
} from "./workspaceSearchMatcher";
import type {
  SearchField as WorkspaceSearchField,
  SearchMatch as CandidateMatch,
} from "./workspaceSearchMatcher";
import {
  narrowSearchableNotes,
  noteSearchCandidates,
  taskSearchCandidates,
} from "./workspaceSearchIndex";
import { sourceSearchSnippet, truncateSearchValue } from "./workspaceSearchPreview";

export type { SearchField as WorkspaceSearchField } from "./workspaceSearchMatcher";

type TaskRecord = IndexSnapshot["tasks"][number];

export interface WorkspaceSearchResult {
  readonly kind: "note" | "task";
  readonly noteUri: string;
  readonly noteTitle: string;
  readonly notePath: string;
  readonly displayText: string;
  readonly preview: string;
  readonly offset: number;
  readonly matchedField: WorkspaceSearchField;
  readonly completed?: boolean;
}

/*
 * Ranking needs only the score and the tie-break strings, so previews and offsets are
 * built after the sort for just the returned slice — a broad query touches every note but
 * renders at most `limit` snippets.
 */
type PendingResult =
  | {
      readonly kind: "note";
      readonly score: number;
      readonly note: NoteRecord;
      readonly match: CandidateMatch;
      readonly modifiedAt: number;
    }
  | {
      readonly kind: "task";
      readonly score: number;
      readonly task: TaskRecord;
      readonly match: CandidateMatch;
      readonly modifiedAt: number;
    };

/**
 * The notes a query matches, by any searchable field — title, path, alias, tag, or body
 * text. This answers the workspace panel's filter, which can only see titles and paths
 * itself: note content never rides to a webview, so the panel asks the host instead.
 * Bounded because a one-letter query matches most of a vault, and an unbounded answer
 * would serialise thousands of URIs for a list that draws a couple hundred rows.
 */
export function matchingNoteUris(
  notes: readonly NoteRecord[],
  query: string,
  limit: number,
): readonly string[] {
  const request = createSearchRequest(query);
  if (request.terms.length === 0 || limit <= 0) {
    return [];
  }
  const candidateUris = narrowSearchableNotes(notes, request.terms);
  const uris: string[] = [];
  for (const note of notes) {
    if (candidateUris !== undefined && !candidateUris.has(note.uri)) {
      continue;
    }
    if (selectSearchMatch(noteSearchCandidates(note), request) !== undefined) {
      uris.push(note.uri);
      if (uris.length >= limit) {
        break;
      }
    }
  }
  return uris;
}

export interface WorkspaceSearchPage {
  readonly results: readonly WorkspaceSearchResult[];
  /**
   * How many matched, not how many were returned. A vault where the answer is result 340 of
   * 1,200 looked exactly like a vault where the note does not exist: the list stopped at the
   * limit and said nothing, so the reader retyped a query that was already right.
   */
  readonly matched: number;
}

export function buildWorkspaceSearchResults(
  snapshot: Pick<IndexSnapshot, "notes" | "tasks">,
  query: string,
  limit = 200,
): readonly WorkspaceSearchResult[] {
  return buildWorkspaceSearchPage(snapshot, query, limit).results;
}

export function buildWorkspaceSearchPage(
  snapshot: Pick<IndexSnapshot, "notes" | "tasks">,
  query: string,
  limit = 200,
): WorkspaceSearchPage {
  const resultLimit = Math.max(0, Math.floor(limit));
  if (resultLimit === 0) {
    return { results: [], matched: 0 };
  }

  const request = createSearchRequest(query);
  const candidateUris = request.terms.length === 0
    ? undefined
    : narrowSearchableNotes(snapshot.notes, request.terms);

  const pending: PendingResult[] = [];
  for (const note of snapshot.notes) {
    if (candidateUris !== undefined && !candidateUris.has(note.uri)) {
      continue;
    }
    const match = selectSearchMatch(noteSearchCandidates(note), request);
    if (match !== undefined) {
      pending.push({
        kind: "note",
        note,
        match,
        score: request.terms.length === 0 ? 100 : match.score,
        modifiedAt: note.modifiedAt,
      });
    }
  }
  /*
   * A task's recency is its note's, and a task record does not carry it. The map is built up
   * front only when there are tasks to rank at all, and it is the same map the returned slice
   * needs afterwards to render task previews.
   */
  let notesByUri: Map<string, NoteRecord> | undefined;
  if (snapshot.tasks.length > 0) {
    notesByUri = new Map(snapshot.notes.map((note) => [note.uri, note]));
  }
  for (const task of snapshot.tasks) {
    const match = selectSearchMatch(taskSearchCandidates(task), request);
    if (match !== undefined) {
      pending.push({
        kind: "task",
        task,
        match,
        score: request.terms.length === 0 ? 90 : match.score,
        modifiedAt: notesByUri?.get(task.noteUri)?.modifiedAt ?? 0,
      });
    }
  }

  pending.sort(comparePending);

  const results = pending.slice(0, resultLimit).map((entry) => {
    if (entry.kind === "note") {
      return noteResult(entry.note, entry.match);
    }
    return taskResult(entry.task, notesByUri?.get(entry.task.noteUri), entry.match);
  });
  return { results, matched: pending.length };
}

function noteResult(note: NoteRecord, match: CandidateMatch): WorkspaceSearchResult {
  const offset = match.candidate.sourceBacked
    ? match.candidate.sourceStart + match.index
    : noteStartOffset(note);
  return {
    kind: "note",
    noteUri: note.uri,
    noteTitle: note.title,
    notePath: note.path,
    displayText: note.title,
    preview: notePreview(note, match, offset),
    offset,
    matchedField: match.candidate.field,
  };
}

function taskResult(
  task: TaskRecord,
  note: NoteRecord | undefined,
  match: CandidateMatch,
): WorkspaceSearchResult {
  return {
    kind: "task",
    noteUri: task.noteUri,
    noteTitle: task.noteTitle,
    notePath: task.notePath,
    displayText: task.text,
    preview: taskPreview(task),
    offset: taskMatchOffset(task, note, match),
    matchedField: "task",
    completed: task.completed,
  };
}

function noteStartOffset(note: NoteRecord): number {
  return note.headings[0]?.range.start ?? 0;
}

function notePreview(note: NoteRecord, match: CandidateMatch, offset: number): string {
  switch (match.candidate.field) {
    case "title":
      return `Title: ${truncateSearchValue(note.title)}`;
    case "path":
      return `Path: ${truncateSearchValue(note.path)}`;
    case "alias":
      return `Alias: ${truncateSearchValue(match.candidate.value)}`;
    case "tag":
      return `Tag: ${truncateSearchValue(withTagMarker(match.candidate.value))}`;
    case "body":
      return sourceSearchSnippet(note.content, offset, match.length);
    case "task":
      return truncateSearchValue(match.candidate.value);
  }
}

function withTagMarker(value: string): string {
  return value.startsWith("#") ? value : `#${value}`;
}

function taskPreview(task: TaskRecord): string {
  const metadata = [
    task.due === undefined ? undefined : `due ${task.due}`,
    task.priority,
    ...task.tags.map((tag) => `#${tag}`),
  ].filter((value): value is string => value !== undefined);
  return truncateSearchValue([task.text, ...metadata].join(" · "));
}

function taskMatchOffset(
  task: TaskRecord,
  note: NoteRecord | undefined,
  match: CandidateMatch,
): number {
  if (note === undefined) {
    return task.range.start;
  }
  const source = note.content.slice(task.range.start, task.range.end);
  const matchTextLower = match.candidate.lower.slice(match.index, match.index + match.length);
  const relativeOffset = matchTextLower === ""
    ? 0
    : lowerValueOffset(lowercasePreservingLength(source), matchTextLower, 0);
  return task.range.start + relativeOffset;
}

/*
 * `localeCompare` pays collator setup on every call, and a broad query produces thousands
 * of equal-score ties that are ordered entirely by string comparison. A shared collator
 * gives the same default-locale ordering at a fraction of the cost.
 */
const tieBreaker = new Intl.Collator();

/*
 * The last tie-break used to be the path, collated. By the time two results have matched
 * equally well, carry the same note title and the same text, alphabetical order of the file
 * they happen to sit in is arbitrary — and a broad query produces hundreds of those. Which one
 * was touched most recently is not arbitrary, and it is the same question the reader is
 * usually asking. The path stays underneath it so the order is still total and stable.
 */
function comparePending(left: PendingResult, right: PendingResult): number {
  return (
    right.score - left.score ||
    tieBreaker.compare(pendingNoteTitle(left), pendingNoteTitle(right)) ||
    tieBreaker.compare(pendingDisplayText(left), pendingDisplayText(right)) ||
    right.modifiedAt - left.modifiedAt ||
    tieBreaker.compare(pendingNotePath(left), pendingNotePath(right))
  );
}

function pendingNoteTitle(entry: PendingResult): string {
  return entry.kind === "note" ? entry.note.title : entry.task.noteTitle;
}

function pendingDisplayText(entry: PendingResult): string {
  return entry.kind === "note" ? entry.note.title : entry.task.text;
}

function pendingNotePath(entry: PendingResult): string {
  return entry.kind === "note" ? entry.note.path : entry.task.notePath;
}
