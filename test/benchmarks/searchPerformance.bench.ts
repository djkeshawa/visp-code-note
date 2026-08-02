/**
 * Workspace search benchmark. Not part of `npm test` — run it directly:
 *
 *   npm run compile:test && node out-tests/test/benchmarks/searchPerformance.bench.js
 *
 * It reports, per workspace size:
 *
 *   - cold: the first query after a snapshot commit, which pays for building the
 *     trigram narrowing index and preparing candidates;
 *   - warm: the median keystroke of a type-ahead session against the same snapshot,
 *     which is what search responsiveness actually feels like;
 *   - save: a query right after a one-note change, which pays for the diff update;
 *   - empty: the browse-everything query, which ranks every note and task.
 */

import { buildWorkspaceSearchResults } from "../../src/application/workspaceSearch";
import { buildSnapshot } from "../../src/indexing/projections";
import type { NoteRecord } from "../../src/domain/models";
import { makeNote } from "../indexing/fixtures";

interface Scenario {
  readonly label: string;
  readonly notes: number;
}

const SCENARIOS: readonly Scenario[] = [
  { label: "small vault", notes: 250 },
  { label: "medium vault", notes: 1000 },
  { label: "large vault", notes: 2500 },
  { label: "very large vault", notes: 5000 },
];

/*
 * A vocabulary of ~1,900 distinct words drawn on a power-law curve, so word frequencies
 * look like prose: a few very common words, a long tail of rare ones. A tiny vocabulary
 * would make every query match every note and measure only the worst case.
 */
const SYLLABLES = [
  "ba", "ce", "di", "fo", "gu", "ha", "ki", "lo", "mu",
  "ne", "po", "ra", "si", "tu", "ve", "wa", "xy", "zo",
];
const WORDS = SYLLABLES.flatMap((first) =>
  SYLLABLES.flatMap((second) => SYLLABLES.slice(0, 6).map((third) => first + second + third)));

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

/** A deterministic prose-shaped vault: paragraphs of shared vocabulary, tags, and tasks. */
function buildVault(count: number): NoteRecord[] {
  const random = seededRandom(20260802);
  const pick = (): string => WORDS[Math.floor(random() ** 2.2 * WORDS.length)] as string;
  return Array.from({ length: count }, (_, index) => {
    const paragraphs = Array.from({ length: 12 }, () =>
      Array.from({ length: 40 }, pick).join(" "));
    return makeNote({
      path: `notes/f${index % 40}/note-${index}.md`,
      content: [
        "---",
        `title: ${pick()} ${pick()} ${index}`,
        `tags: [${pick()}, ${pick()}]`,
        "---",
        `# Note ${index}`,
        ...paragraphs,
        `- [ ] Follow up on ${pick()} #${pick()}`,
      ].join("\n"),
    });
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

const TYPE_AHEAD = ["x", "xy", "xyx", "xyxy", "xyxydi", "xyxydi lo", "xyxydi loha"];

for (const scenario of SCENARIOS) {
  const notes = buildVault(scenario.notes);
  const snapshot = buildSnapshot(notes, 1, 1);

  const cold = measure(() => buildWorkspaceSearchResults(snapshot, "xyxydi"));
  const warm = median(TYPE_AHEAD.map((query) =>
    measure(() => buildWorkspaceSearchResults(snapshot, query))));

  const changed = [...notes];
  changed[0] = makeNote({
    path: "notes/f0/note-0.md",
    content: "# Note 0\nEdited to mention a porphyry outcrop.\n",
  });
  const next = buildSnapshot(changed, 2, 2);
  const save = measure(() => buildWorkspaceSearchResults(next, "porphyry"));

  const empty = measure(() => buildWorkspaceSearchResults(snapshot, ""));

  // eslint-disable-next-line no-console
  console.log(
    `${scenario.label} (${scenario.notes} notes): ` +
    `cold ${cold.toFixed(1)}ms, warm ${warm.toFixed(2)}ms, ` +
    `after-save ${save.toFixed(1)}ms, empty ${empty.toFixed(1)}ms`,
  );
}
