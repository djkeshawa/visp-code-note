/**
 * Index projection benchmark. Not part of `npm test` — run it directly:
 *
 *   npm run compile:test && node out-tests/test/benchmarks/indexProjectionPerformance.bench.js
 *
 * Every scenario is measured twice: once with the per-note projection cache, and once with it
 * bypassed exactly as `vispNotes.index.bypassProjectionCache` does. The bypassed column is
 * what this code did before the cache existed, so the comparison is re-measured on whatever
 * machine runs it rather than quoted from a commit message that has since gone stale.
 *
 * Scenarios, per workspace size:
 *
 *   - rebuild: the first commit after startup or Rebuild Index, which has nothing to reuse;
 *   - body edit: a save that changed one note's prose, which is what continuous typing
 *     produces every 120ms through the watcher debounce, and the number that decides whether
 *     the extension host keeps up;
 *   - retitle: a save that changed one note's frontmatter title, which moves the name-space
 *     and so must re-resolve every link in the workspace.
 *
 * Measured on the machine this was written on, in milliseconds, cached → bypassed:
 *
 *                  500        1000         2000         4000
 *   rebuild     32 → 26     60 → 56    120 → 122    269 → 284
 *   body edit  2.2 → 24    5.7 → 53   13.0 → 105   36.8 → 259
 *   retitle     26 → 25     58 → 53    129 → 119    283 → 313
 *
 * The watcher debounce is 120ms, so the body-edit row is the one that decides whether the
 * extension host keeps up with someone typing: at 2,000 notes it is the difference between
 * finishing inside the window with room to spare and never catching up at all.
 *
 * Rebuild and retitle are the cases the cache cannot help — a name-space change invalidates
 * every note, so both columns do the same work, and the cached one additionally compares the
 * name-space and writes 2,000 cache entries it will discard. Measured over interleaved runs
 * that costs about 7% on a retitle, against roughly eight times faster on a body edit. Both
 * columns swing by a third between runs at 4,000 notes, so read the shape, not the digits.
 */

import { buildSnapshot, createNoteProjector } from "../../src/indexing/projections";
import type { NoteProjector } from "../../src/indexing/projections";
import type { NoteRecord } from "../../src/domain/models";
import { makeNote } from "../indexing/fixtures";

const SIZES = [500, 1000, 2000, 4000] as const;

/** Links per note, near enough to what a worked-in vault carries. */
const LINKS_PER_NOTE = 10;

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function noteContent(index: number, title: string, targets: readonly number[], body: string): string {
  return [
    "---",
    `title: ${title}`,
    "tags: [alpha, beta]",
    "---",
    `# ${title}`,
    ...targets.map((target, line) => `Paragraph ${line} mentions [[Note ${target}]] and prose. ${body}`),
    "- [ ] Follow up @due(2026-07-23)",
    "- [x] Done thing",
  ].join("\n");
}

/*
 * Notes are spread across forty folders and link at random across the whole vault, so the
 * backlink array is wide rather than a handful of hubs — a vault where every mention lands on
 * one note would make the per-target grouping look far better than it is.
 */
function buildVault(count: number): NoteRecord[] {
  const random = seededRandom(20260815);
  return Array.from({ length: count }, (_, index) => {
    const targets = Array.from({ length: LINKS_PER_NOTE },
      () => Math.floor(random() * count));
    return makeNote({
      path: `notes/f${index % 40}/note-${index}.md`,
      content: noteContent(index, `Note ${index}`, targets, ""),
    });
  });
}

function targetsOf(note: NoteRecord): readonly number[] {
  return note.links.map((link) => Number(link.target.replace("Note ", "")));
}

/** One note's prose changed, every name in the workspace left alone. */
function editedNote(note: NoteRecord, index: number, revision: number): NoteRecord {
  return makeNote({
    path: `notes/f${index % 40}/note-${index}.md`,
    content: noteContent(index, `Note ${index}`, targetsOf(note), `Revision ${revision}.`),
  });
}

/** One note's frontmatter title changed, and nothing else — the same links, the same prose. */
function retitledNote(note: NoteRecord, index: number, revision: number): NoteRecord {
  return makeNote({
    path: `notes/f${index % 40}/note-${index}.md`,
    content: noteContent(index, `Note ${index} rev ${revision}`, targetsOf(note), ""),
  });
}

function measure(run: () => void): number {
  const start = performance.now();
  run();
  return performance.now() - start;
}

function median(samples: readonly number[]): number {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

interface Row {
  readonly rebuild: number;
  readonly bodyEdit: number;
  readonly retitle: number;
}

/*
 * Every figure is a median, and every replacement record is built outside the timed region:
 * parsing a note costs more than committing one, so measuring the two together would report
 * the parser and call it the index.
 */
function run(notes: readonly NoteRecord[], cache: boolean): Row {
  const commitWith = (projector: NoteProjector) => {
    let version = 0;
    return (records: readonly NoteRecord[]): void => {
      version += 1;
      buildSnapshot(records, version, version, projector);
    };
  };

  const rebuild = median(Array.from({ length: 5 }, () => {
    const commit = commitWith(createNoteProjector({ cache }));
    return measure(() => commit(notes));
  }));

  const scenario = (
    replace: (note: NoteRecord, index: number, revision: number) => NoteRecord,
    runs: number,
  ): number => {
    const commit = commitWith(createNoteProjector({ cache }));
    const working = [...notes];
    commit(working);
    const samples: number[] = [];
    for (let revision = 0; revision < runs; revision += 1) {
      const index = revision % working.length;
      const next = replace(notes[index] as NoteRecord, index, revision);
      working[index] = next;
      samples.push(measure(() => commit(working)));
    }
    return median(samples);
  };

  return { rebuild, bodyEdit: scenario(editedNote, 15), retitle: scenario(retitledNote, 9) };
}

for (const size of SIZES) {
  const notes = buildVault(size);
  const cached = run(notes, true);
  const bypassed = run(notes, false);
  // eslint-disable-next-line no-console
  console.log(
    `${size} notes: ` +
    `rebuild ${cached.rebuild.toFixed(0)}ms → ${bypassed.rebuild.toFixed(0)}ms bypassed, ` +
    `body edit ${cached.bodyEdit.toFixed(1)}ms → ${bypassed.bodyEdit.toFixed(0)}ms, ` +
    `retitle ${cached.retitle.toFixed(0)}ms → ${bypassed.retitle.toFixed(0)}ms`,
  );
}
