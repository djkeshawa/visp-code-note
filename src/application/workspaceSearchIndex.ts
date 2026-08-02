import type { IndexSnapshot, NoteRecord } from "../domain/models";
import { lowerValueOffset, lowercasePreservingLength } from "./workspaceSearchMatcher";
import type { SearchCandidate, SearchField, SearchTerm } from "./workspaceSearchMatcher";

type TaskRecord = IndexSnapshot["tasks"][number];

const TRIGRAM_LENGTH = 3;

/**
 * Body text beyond this many code units is not trigram-indexed. A note whose body exceeds
 * the cap is instead treated as a candidate for every query, so a match past the cap is
 * still found by verification — the cap trades index memory, not correctness.
 */
const BODY_INDEX_LIMIT = 16 * 1024;

/*
 * Candidates are derived data: everything in them comes from the record itself, and records
 * are immutable — the workspace index replaces a note's record when the file changes. Keying
 * on record identity therefore caches across snapshots for free: a commit that touches one
 * file re-prepares one note, and every keystroke of a search reuses the rest.
 */
const noteCandidateCache = new WeakMap<NoteRecord, readonly SearchCandidate[]>();
const taskCandidateCache = new WeakMap<TaskRecord, readonly SearchCandidate[]>();

export function noteSearchCandidates(note: NoteRecord): readonly SearchCandidate[] {
  let candidates = noteCandidateCache.get(note);
  if (candidates === undefined) {
    candidates = buildNoteCandidates(note);
    noteCandidateCache.set(note, candidates);
  }
  return candidates;
}

export function taskSearchCandidates(task: TaskRecord): readonly SearchCandidate[] {
  let candidates = taskCandidateCache.get(task);
  if (candidates === undefined) {
    candidates = buildTaskCandidates(task);
    taskCandidateCache.set(task, candidates);
  }
  return candidates;
}

/**
 * Narrows a query to the notes that can possibly match every term, using a trigram index
 * over each note's searchable text. Returns the URIs to verify, or `undefined` when the
 * query offers no narrowing (every term is shorter than a trigram) and the caller should
 * scan all notes. The result may contain false positives — the caller's exact matcher is
 * still the authority — but never false negatives.
 *
 * The index is kept in a single-entry cache keyed on the notes array, which the workspace
 * index replaces on every commit. A cache miss is reconciled by diffing record identities,
 * so a one-file save re-indexes one note rather than the vault. The cache intentionally
 * retains the last snapshot's records, matching what the workspace index itself holds.
 */
export function narrowSearchableNotes(
  notes: readonly NoteRecord[],
  terms: readonly SearchTerm[],
): ReadonlySet<string> | undefined {
  return ensureNarrowingIndex(notes).candidateUris(terms);
}

/**
 * Builds (or reconciles) the narrowing index ahead of a query. The first index build walks
 * every note body once, so callers that know a search is coming — the search command as it
 * opens its picker — can pay that cost before the first keystroke instead of during it.
 */
export function warmWorkspaceSearchIndex(notes: readonly NoteRecord[]): void {
  ensureNarrowingIndex(notes);
}

function ensureNarrowingIndex(notes: readonly NoteRecord[]): NoteNarrowingIndex {
  if (narrowingCache === undefined) {
    narrowingCache = { notes, index: new NoteNarrowingIndex() };
    narrowingCache.index.update(notes);
  } else if (narrowingCache.notes !== notes) {
    narrowingCache.index.update(notes);
    narrowingCache.notes = notes;
  }
  return narrowingCache.index;
}

interface NarrowingCache {
  notes: readonly NoteRecord[];
  readonly index: NoteNarrowingIndex;
}

let narrowingCache: NarrowingCache | undefined;

interface IndexedNote {
  readonly id: number;
  readonly record: NoteRecord;
}

class NoteNarrowingIndex {
  /** Posting lists hold note ids in ascending order; ids are minted monotonically. */
  private readonly postings = new Map<number, number[]>();
  private readonly byUri = new Map<string, IndexedNote>();
  private readonly uriById = new Map<number, string>();
  private readonly oversized = new Set<string>();
  private nextId = 0;

  update(notes: readonly NoteRecord[]): void {
    const current = new Map(notes.map((note) => [note.uri, note]));
    const removals: [string, IndexedNote][] = [];
    for (const [uri, entry] of this.byUri) {
      if (current.get(uri) !== entry.record) {
        removals.push([uri, entry]);
      }
    }
    /*
     * Removal splices ids out of every posting list the note appears in, which is the right
     * cost for a save touching a note or two but quadratic-shaped when most of the index is
     * leaving — switching workspaces, or the first index after a full rebuild that reread
     * every file. Past half the index, starting over is strictly cheaper.
     */
    if (removals.length * 2 > this.byUri.size) {
      this.clear();
      for (const note of notes) {
        this.addNote(note);
      }
      return;
    }
    for (const [uri, entry] of removals) {
      this.removeNote(uri, entry);
    }
    for (const note of notes) {
      if (!this.byUri.has(note.uri)) {
        this.addNote(note);
      }
    }
  }

  candidateUris(terms: readonly SearchTerm[]): ReadonlySet<string> | undefined {
    let ids: readonly number[] | undefined;
    let narrowed = false;
    for (const term of terms) {
      for (const gram of termTrigrams(term.lower)) {
        narrowed = true;
        const posting = this.postings.get(gram) ?? [];
        ids = ids === undefined ? posting : intersectSorted(ids, posting);
        if (ids.length === 0) {
          break;
        }
      }
      if (ids !== undefined && ids.length === 0) {
        break;
      }
    }
    if (!narrowed) {
      return undefined;
    }

    const uris = new Set(this.oversized);
    for (const id of ids ?? []) {
      const uri = this.uriById.get(id);
      if (uri !== undefined) {
        uris.add(uri);
      }
    }
    return uris;
  }

  /*
   * Streams grams straight into the posting lists rather than deduplicating into a Set
   * first: appends for one note are consecutive, so a repeated gram is exactly the one
   * whose posting already ends in this id. Indexing a vault touches every code unit of
   * every body once, which makes this the cost that decides cold-start time.
   */
  private clear(): void {
    this.postings.clear();
    this.byUri.clear();
    this.uriById.clear();
    this.oversized.clear();
    this.nextId = 0;
  }

  private addNote(note: NoteRecord): void {
    const id = this.nextId;
    this.nextId += 1;
    this.byUri.set(note.uri, { id, record: note });
    this.uriById.set(id, note.uri);
    for (const candidate of noteSearchCandidates(note)) {
      const limit = candidate.field === "body" ? BODY_INDEX_LIMIT : Infinity;
      const lower = candidate.lower;
      if (lower.length > limit) {
        this.oversized.add(note.uri);
      }
      const end = Math.min(lower.length, limit) - (TRIGRAM_LENGTH - 1);
      for (let index = 0; index < end; index += 1) {
        const gram = (lower.charCodeAt(index) * 0x1_0000 + lower.charCodeAt(index + 1)) * 0x1_0000 +
          lower.charCodeAt(index + 2);
        const posting = this.postings.get(gram);
        if (posting === undefined) {
          this.postings.set(gram, [id]);
        } else if (posting[posting.length - 1] !== id) {
          posting.push(id);
        }
      }
    }
  }

  private removeNote(uri: string, entry: IndexedNote): void {
    this.byUri.delete(uri);
    this.uriById.delete(entry.id);
    this.oversized.delete(uri);
    for (const gram of noteTrigrams(entry.record)) {
      const posting = this.postings.get(gram);
      if (posting === undefined) {
        continue;
      }
      const at = sortedIndexOf(posting, entry.id);
      if (at >= 0) {
        posting.splice(at, 1);
      }
      if (posting.length === 0) {
        this.postings.delete(gram);
      }
    }
  }
}

/**
 * The distinct grams a note was indexed under, recomputed for removal. Must mirror what
 * `addNote` inserted, including the body cap.
 */
function noteTrigrams(note: NoteRecord): ReadonlySet<number> {
  const trigrams = new Set<number>();
  for (const candidate of noteSearchCandidates(note)) {
    const limit = candidate.field === "body" ? BODY_INDEX_LIMIT : Infinity;
    collectTrigrams(trigrams, candidate.lower, limit);
  }
  return trigrams;
}

function termTrigrams(lower: string): readonly number[] {
  if (lower.length < TRIGRAM_LENGTH) {
    return [];
  }
  const trigrams = new Set<number>();
  collectTrigrams(trigrams, lower, Infinity);
  return [...trigrams];
}

/*
 * A trigram is packed into one number — three 16-bit code units fit exactly in a double's
 * integer range — so indexing a note allocates no substring per position and posting lookups
 * hash a number instead of a string.
 */
function collectTrigrams(target: Set<number>, lower: string, limit: number): void {
  const end = Math.min(lower.length, limit) - (TRIGRAM_LENGTH - 1);
  for (let index = 0; index < end; index += 1) {
    target.add(
      (lower.charCodeAt(index) * 0x1_0000 + lower.charCodeAt(index + 1)) * 0x1_0000 +
        lower.charCodeAt(index + 2),
    );
  }
}

function intersectSorted(left: readonly number[], right: readonly number[]): number[] {
  const result: number[] = [];
  let leftAt = 0;
  let rightAt = 0;
  while (leftAt < left.length && rightAt < right.length) {
    const leftId = left[leftAt] as number;
    const rightId = right[rightAt] as number;
    if (leftId === rightId) {
      result.push(leftId);
      leftAt += 1;
      rightAt += 1;
    } else if (leftId < rightId) {
      leftAt += 1;
    } else {
      rightAt += 1;
    }
  }
  return result;
}

function sortedIndexOf(posting: readonly number[], id: number): number {
  let low = 0;
  let high = posting.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const value = posting[mid] as number;
    if (value === id) {
      return mid;
    }
    if (value < id) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return -1;
}

function buildNoteCandidates(note: NoteRecord): readonly SearchCandidate[] {
  const contentLower = lowercasePreservingLength(note.content);
  return [
    metadataCandidate(contentLower, "title", note.title, 1_000),
    virtualCandidate("path", note.path, 850),
    ...note.aliases.map((alias) => metadataCandidate(contentLower, "alias", alias, 900)),
    ...note.tags.flatMap((tag) => [
      metadataCandidate(contentLower, "tag", tag, 800),
      metadataCandidate(contentLower, "tag", `#${tag}`, 799),
    ]),
    {
      field: "body" as const,
      value: note.content,
      lower: contentLower,
      weight: 400,
      sourceStart: 0,
      sourceBacked: true,
    },
  ];
}

function buildTaskCandidates(task: TaskRecord): readonly SearchCandidate[] {
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

function metadataCandidate(
  contentLower: string,
  field: SearchField,
  value: string,
  weight: number,
): SearchCandidate {
  const lower = lowercasePreservingLength(value);
  const offset = lowerValueOffset(contentLower, lower, -1);
  return offset < 0
    ? { field, value, lower, weight, sourceStart: 0, sourceBacked: false }
    : { field, value, lower, weight, sourceStart: offset, sourceBacked: true };
}

function virtualCandidate(field: SearchField, value: string, weight: number): SearchCandidate {
  return {
    field,
    value,
    lower: lowercasePreservingLength(value),
    weight,
    sourceStart: 0,
    sourceBacked: false,
  };
}
