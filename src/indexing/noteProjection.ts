import type {
  Backlink,
  IndexSnapshot,
  NoteRecord,
  ResolvedLink,
} from "../domain/models";
import { lineNumberAtOffset, scanLines } from "../markdown/lines";
import { createNoteResolver } from "./noteResolver";

type SnapshotTask = IndexSnapshot["tasks"][number];

/** Everything a snapshot says about one note: its links, the mentions it makes, its tasks. */
export interface NoteProjection {
  readonly links: readonly ResolvedLink[];
  /** Mentions this note makes of other notes, not mentions of it. */
  readonly backlinks: readonly Backlink[];
  readonly tasks: readonly SnapshotTask[];
}

export interface NoteProjector {
  /**
   * The projections for one commit, in the order the notes were given — which `buildSnapshot`
   * has already put in `compareNotes` order.
   */
  project(notes: readonly NoteRecord[]): readonly NoteProjection[];
  /**
   * How many times the resolvable name-space has moved. Exposed so the invalidation table can
   * be pinned: correctness alone cannot tell a cache that works from one that never hits.
   *
   * Only under the cache. The bypass keys nothing on this and moves it once per commit, so
   * reading it there counts commits and says nothing about any name.
   */
  readonly generation: number;
}

export interface NoteProjectorOptions {
  /**
   * False rebuilds every projection — and the resolver they are projected against — on every
   * commit, consulting nothing this file remembers. The bypass, for settling a report.
   */
  readonly cache?: boolean;
}

/**
 * Only the target's URI leaves the resolver, and that is deliberate.
 *
 * A projection outlives the commit that made it, so anything it copies out of another note's
 * record would still be there after that record was replaced. A URI is the one thing that
 * cannot go stale without the name-space moving — which is the very thing the generation
 * counter watches — so making it the only thing this interface can return means a later edit
 * to `projectNote` cannot quietly reintroduce a stale title or a stale line of text.
 */
interface TargetResolver {
  resolve(sourceUri: string, target: string): string | undefined;
}

interface CacheEntry {
  readonly generation: number;
  readonly projection: NoteProjection;
}

/*
 * Records are immutable: the workspace index replaces a note's record when the file changes,
 * and never edits one in place. The search index already leans on that a level down, and this
 * is the same rule applied to the projection — a commit that touches one file re-projects one
 * note instead of re-resolving every link in the vault.
 *
 * Record identity is not enough on its own, though. A note's links are resolved against every
 * other note's name, so an untouched note's projection stops being true the moment some other
 * note is created, deleted, renamed, retitled, moved or re-aliased. The generation counter is
 * that second key, and it is derived from the names themselves rather than from a list of the
 * events that ought to change them — an event this file forgot to list would be invisible,
 * whereas a name it compares wrongly can only compare unequal and re-project too much.
 */
export function createNoteProjector(options: NoteProjectorOptions = {}): NoteProjector {
  const cache = options.cache === false ? undefined : new WeakMap<NoteRecord, CacheEntry>();
  let generation = 0;
  let previous: readonly NoteRecord[] = [];
  let resolver: TargetResolver = targetResolver([]);

  return {
    get generation() {
      return generation;
    },
    project(notes) {
      /*
       * The bypass rebuilds the resolver too, not only the per-note memo.
       *
       * `sameNameSpace` gates two things: whether a projection may be reused, and whether the
       * resolver every link is resolved against is rebuilt. A bypass that skipped the memo but
       * kept that gate would re-project every note against the same possibly-stale resolver and
       * arrive at the same possibly-wrong link — so the one report it exists to settle, a link
       * pointing at a note that no longer answers to that name, would read identically with the
       * setting on and off, and the reader would be told "not the cache" with no evidence.
       *
       * Taking the gate out of this path is what makes the answer independent: names are read
       * fresh from the notes in hand on every commit, so anything `sameNameSpace` gets wrong
       * shows up as the two modes disagreeing. The generation counter still moves once per
       * commit here, because with no memo to key, every commit is a full re-projection.
       */
      if (cache === undefined) {
        generation += 1;
        const fresh = targetResolver(notes);
        return notes.map((note) => projectNote(note, fresh));
      }
      if (!sameNameSpace(previous, notes)) {
        generation += 1;
        resolver = targetResolver(notes);
      }
      /*
       * Always the list just seen, not the last one that moved the name-space. Holding the
       * older list would keep a whole vault of superseded records — their full text included —
       * alive for as long as someone kept typing without renaming anything, and comparing
       * against the immediate predecessor says the same thing: equal names are transitive, so
       * a chain of unchanged commits is still unchanged from the first.
       */
      previous = notes;
      return notes.map((note) => {
        const entry = cache.get(note);
        if (entry !== undefined && entry.generation === generation) {
          return entry.projection;
        }
        const projection = projectNote(note, resolver);
        cache.set(note, { generation, projection });
        return projection;
      });
    },
  };
}

function targetResolver(notes: readonly NoteRecord[]): TargetResolver {
  const resolver = createNoteResolver(notes);
  return {
    resolve: (sourceUri, target) => resolver.resolve(sourceUri, target)?.uri,
  };
}

/**
 * Whether the two lists offer a link exactly the same names to land on.
 *
 * These are the four fields `createNoteResolver` reads — the URI it answers with, the path it
 * indexes by full path, by stem and by every suffix and which decides ties, the title, and the
 * aliases. Both lists arrive in `compareNotes` order, so comparing them position by position
 * is enough: equal at every position means the same sequence of names built the same way.
 *
 * Comparing fields rather than counting events is what makes this safe. The only way to be
 * wrong here is to call two lists different when they were the same, which costs a needless
 * re-projection and nothing else.
 *
 * The URI comparison is the one line here no test can fail on its own: a file cannot move
 * without its path moving too, so path already catches every reachable case. It stays because
 * the resolver is keyed on URI as well, and this function should not be the place where that
 * invariant is quietly assumed.
 */
function sameNameSpace(
  previous: readonly NoteRecord[],
  next: readonly NoteRecord[],
): boolean {
  if (previous.length !== next.length) {
    return false;
  }
  for (let index = 0; index < next.length; index += 1) {
    const before = previous[index];
    const after = next[index];
    if (before === after) continue;
    if (
      before === undefined ||
      after === undefined ||
      before.uri !== after.uri ||
      before.path !== after.path ||
      before.title !== after.title ||
      !sameNames(before.aliases, after.aliases)
    ) {
      return false;
    }
  }
  return true;
}

function sameNames(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function projectNote(note: NoteRecord, resolver: TargetResolver): NoteProjection {
  const links: ResolvedLink[] = [];
  const backlinks: Backlink[] = [];
  const lines = scanLines(note.content);
  for (const link of note.links) {
    const targetUri = resolver.resolve(note.uri, link.target);
    links.push(Object.freeze({
      sourceUri: note.uri,
      link,
      ...(targetUri === undefined ? {} : { targetUri }),
    }));
    /*
     * A backlink is a mention from somewhere else. `[[#Heading]]` and `[[^block]]` point
     * inside the note being read, and the resolver answers them with that same note, so
     * recording them here made a note appear in its own backlinks list — once per anchor.
     */
    if (targetUri !== undefined && targetUri !== note.uri) {
      backlinks.push(Object.freeze({
        sourceUri: note.uri,
        sourceTitle: note.title,
        sourcePath: note.path,
        targetUri,
        range: link.range,
        context: lineContext(note.content, link.range.start),
        line: lineNumberAtOffset(lines, link.range.start),
      }));
    }
  }
  return Object.freeze({
    links: Object.freeze(links),
    backlinks: Object.freeze(backlinks),
    tasks: Object.freeze(note.tasks.map((task) => Object.freeze({
      ...task,
      noteUri: note.uri,
      noteTitle: note.title,
      notePath: note.path,
      ...(note.createdAt === undefined ? {} : { noteCreatedAt: note.createdAt }),
    }))),
  });
}

function lineContext(content: string, offset: number): string {
  let start = Math.min(Math.max(0, offset), content.length);
  let end = start;
  while (start > 0 && content[start - 1] !== "\n" && content[start - 1] !== "\r") start -= 1;
  while (end < content.length && content[end] !== "\n" && content[end] !== "\r") end += 1;
  return content.slice(start, end).trim();
}
