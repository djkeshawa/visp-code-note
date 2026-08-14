import type { SkippedNote } from "../domain/models";

/**
 * What the two places index health lives — the status bar item and the workspace panel's
 * footer — say about the notes the size limit left out.
 *
 * The wording is here rather than in either of them because they sit side by side in the
 * window and a reader compares them: the note and task counts are already computed twice from
 * the same snapshot precisely so they cannot contradict each other, and this is the same
 * promise for a harder sentence. The webview imports it too, so there is one copy of it.
 *
 * The size ceiling itself is not in question — see `noteSizeLimit` for why it exists. What was
 * missing was any way for the reader to get from "my note is gone and its links are broken" to
 * "a setting excluded it", so every sentence here names the count, the reason and the setting.
 */

/** Bytes as the setting spells them, since the setting is what the reader has to change. */
function kilobytes(bytes: number): number {
  return Math.round(bytes / 1024);
}

/** The tally that sits beside the note and task counts. */
export function oversizedTally(count: number): string {
  return `${count} not indexed`;
}

/**
 * Why those notes are not indexed, in one sentence, or `undefined` when none were skipped.
 *
 * A workspace folder can set its own ceiling, so the limit is only named when every skipped
 * note was measured against the same one; naming one of several would send a reader to change
 * a setting that was not the one that excluded their note.
 */
export function oversizedReason(skipped: readonly SkippedNote[]): string | undefined {
  if (skipped.length === 0) return undefined;
  const first = skipped[0];
  if (first === undefined) return undefined;
  const shared = skipped.every((entry) => entry.limitBytes === first.limitBytes);
  const ceiling = shared ? `the ${kilobytes(first.limitBytes)} KB limit` : "their size limit";
  const one = skipped.length === 1;
  const subject = one ? "1 note is" : `${skipped.length} notes are`;
  const them = one ? "it" : "they";
  return `${subject} larger than ${ceiling}, so ${them} ${one ? "is" : "are"} not indexed: `
    + `${them} will not appear in search, the graph, or backlinks. `
    + `Raise vispNotes.maxNoteSizeKB to include ${one ? "it" : "them"}.`;
}

/** One skipped note, named and measured — for the reader who clicked a link to it. */
export function describeOversizedNote(skipped: SkippedNote): string {
  return `“${skipped.path}” is ${kilobytes(skipped.sizeBytes)} KB, over the `
    + `${kilobytes(skipped.limitBytes)} KB limit in vispNotes.maxNoteSizeKB, so it is not `
    + "indexed. The file is on disk and opens normally; nothing needs creating.";
}
