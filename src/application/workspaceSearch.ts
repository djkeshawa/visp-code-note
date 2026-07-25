import type { IndexSnapshot, NoteRecord } from "../domain/models";
import {
  createSearchRequest,
  selectSearchMatch,
  valueOffset,
} from "./workspaceSearchMatcher";
import type {
  SearchCandidate as Candidate,
  SearchField as WorkspaceSearchField,
  SearchMatch as CandidateMatch,
  SearchRequest,
} from "./workspaceSearchMatcher";
import { sourceSearchSnippet, truncateSearchValue } from "./workspaceSearchPreview";

export type { SearchField as WorkspaceSearchField } from "./workspaceSearchMatcher";

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

interface RankedResult extends WorkspaceSearchResult {
  readonly score: number;
}

export function buildWorkspaceSearchResults(
  snapshot: Pick<IndexSnapshot, "notes" | "tasks">,
  query: string,
  limit = 200,
): readonly WorkspaceSearchResult[] {
  const resultLimit = Math.max(0, Math.floor(limit));
  if (resultLimit === 0) {
    return [];
  }

  const request = createSearchRequest(query);
  const notesByUri = new Map(snapshot.notes.map((note) => [note.uri, note]));
  const results: RankedResult[] = [];

  for (const note of snapshot.notes) {
    const result = searchNote(note, request);
    if (result !== undefined) {
      results.push(result);
    }
  }
  for (const task of snapshot.tasks) {
    const result = searchTask(task, notesByUri.get(task.noteUri), request);
    if (result !== undefined) {
      results.push(result);
    }
  }

  results.sort(compareResults);
  return results.slice(0, resultLimit).map(({ score: _score, ...result }) => result);
}

function searchNote(note: NoteRecord, request: SearchRequest): RankedResult | undefined {
  const candidates = noteCandidates(note);
  const match = selectSearchMatch(candidates, request);
  if (match === undefined) {
    return undefined;
  }

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
    score: request.terms.length === 0 ? 100 : match.score,
  };
}

function searchTask(
  task: IndexSnapshot["tasks"][number],
  note: NoteRecord | undefined,
  request: SearchRequest,
): RankedResult | undefined {
  const candidates = taskCandidates(task);
  const match = selectSearchMatch(candidates, request);
  if (match === undefined) {
    return undefined;
  }

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
    score: request.terms.length === 0 ? 90 : match.score,
  };
}

function noteCandidates(note: NoteRecord): readonly Candidate[] {
  return [
    metadataCandidate(note, "title", note.title, 1_000),
    pathCandidate(note.path),
    ...note.aliases.map((alias) => metadataCandidate(note, "alias", alias, 900)),
    ...note.tags.flatMap((tag) => [
      metadataCandidate(note, "tag", tag, 800),
      metadataCandidate(note, "tag", `#${tag}`, 799),
    ]),
    sourceCandidate("body", note.content, 400, 0),
  ];
}

function taskCandidates(task: IndexSnapshot["tasks"][number]): readonly Candidate[] {
  return [
    virtualCandidate("task", task.text, 780),
    ...task.tags.map((tag) => virtualCandidate("task", `#${tag}`, 740)),
    ...(task.due === undefined ? [] : [virtualCandidate("task", task.due, 720)]),
    ...(task.priority === undefined ? [] : [virtualCandidate("task", task.priority, 700)]),
    virtualCandidate("task", task.noteTitle, 650),
    virtualCandidate("task", task.notePath, 620),
    virtualCandidate("task", task.completed ? "completed done" : "open incomplete", 500),
  ];
}

function sourceCandidate(
  field: WorkspaceSearchField,
  value: string,
  weight: number,
  sourceStart: number,
): Candidate {
  return { field, value, weight, sourceStart, sourceBacked: true };
}

function virtualCandidate(field: WorkspaceSearchField, value: string, weight: number): Candidate {
  return { field, value, weight, sourceStart: 0, sourceBacked: false };
}

function pathCandidate(path: string): Candidate {
  return virtualCandidate("path", path, 850);
}

function metadataCandidate(
  note: NoteRecord,
  field: WorkspaceSearchField,
  value: string,
  weight: number,
): Candidate {
  const offset = valueOffset(note.content, value, -1);
  return offset < 0
    ? virtualCandidate(field, value, weight)
    : sourceCandidate(field, value, weight, offset);
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

function taskPreview(task: IndexSnapshot["tasks"][number]): string {
  const metadata = [
    task.due === undefined ? undefined : `due ${task.due}`,
    task.priority,
    ...task.tags.map((tag) => `#${tag}`),
  ].filter((value): value is string => value !== undefined);
  return truncateSearchValue([task.text, ...metadata].join(" · "));
}

function taskMatchOffset(
  task: IndexSnapshot["tasks"][number],
  note: NoteRecord | undefined,
  match: CandidateMatch,
): number {
  if (note === undefined) {
    return task.range.start;
  }
  const source = note.content.slice(task.range.start, task.range.end);
  const matchText = match.candidate.value.slice(match.index, match.index + match.length);
  const relativeOffset = matchText === "" ? 0 : valueOffset(source, matchText, 0);
  return task.range.start + relativeOffset;
}

function compareResults(left: RankedResult, right: RankedResult): number {
  return (
    right.score - left.score ||
    left.noteTitle.localeCompare(right.noteTitle) ||
    left.displayText.localeCompare(right.displayText) ||
    left.notePath.localeCompare(right.notePath)
  );
}
