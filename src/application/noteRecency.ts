/**
 * How long ago a note's file was last written, in words — and what that does and does not mean.
 *
 * Separate from `formatIndexedAt`, which answers a different question about a different clock:
 * that one says whether the index is current and gets coarser the further back it goes, because
 * nobody needs the minute. This one is read against a list of notes a reader is trying to
 * recognise, so it keeps "yesterday" and then falls back to the date — "43d ago" is not a day
 * anyone can place.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export function formatNoteRecency(modifiedAt: number, now = Date.now()): string {
  if (modifiedAt <= 0) return "date unknown";
  const seconds = Math.max(0, Math.round((now - modifiedAt) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const days = wholeDaysBetween(modifiedAt, now);
  if (days === 0) return `${Math.max(1, Math.round(minutes / 60))}h ago`;
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" })
    .format(new Date(modifiedAt));
}

/**
 * Calendar days apart, not elapsed hours divided by 24. A note written at 11pm is "yesterday"
 * at 1am and not "2h ago", because that is the word the reader would use for it.
 */
function wholeDaysBetween(modifiedAt: number, now: number): number {
  const then = new Date(modifiedAt);
  const today = new Date(now);
  then.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((today.getTime() - then.getTime()) / DAY_MS));
}

/**
 * What the Recent list is actually a list of.
 *
 * Said in full, and on the list itself, because the honest answer is not the one the title
 * implies: this is the file's modification time, which is a proxy for when a note was written
 * and not a record of it. A bulk find-and-replace across the vault reorders the whole view,
 * and nothing here can tell that apart from an evening's writing. Creation time would be the
 * better question and cannot be asked — some file systems report a zero `ctime`, so the index
 * leaves `createdAt` off entirely rather than claiming 1970.
 */
export const RECENT_LISTING_MEANING =
  "Ordered by when each file was last changed on disk. That is not the same as when you wrote "
  + "it — anything that rewrites files, such as a rename or a find-and-replace across the "
  + "vault, moves those notes to the top.";
