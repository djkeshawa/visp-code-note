/**
 * How large a note may be before the index leaves it alone.
 *
 * The index keeps every note's full text in memory, and the search index keeps a second
 * structure beside it, so a workspace costs a multiple of its own Markdown. Nothing bounded
 * that: a repository carrying a few hundred megabytes of `.md` — which a cloned repository
 * chooses, since this extension supports untrusted workspaces — exhausted the extension host
 * before anything was opened.
 *
 * A ceiling rather than a smarter budget, because the failure it prevents is a hard one and
 * the honest limit is "no single note should be this big". Five megabytes is roughly a
 * million words; the largest notes real people write are a small fraction of it.
 */
export const DEFAULT_MAX_NOTE_SIZE_KB = 5120;

/**
 * The ceiling in bytes, or `undefined` for no ceiling.
 *
 * Zero and below mean unlimited, which is the escape hatch for someone who genuinely keeps a
 * enormous note and would rather spend the memory. A value that is not a usable number falls
 * back to the default instead of disabling the limit, so a malformed setting cannot quietly
 * remove the protection.
 */
export function noteSizeLimitBytes(configured: unknown): number | undefined {
  if (typeof configured !== "number" || !Number.isFinite(configured)) {
    return DEFAULT_MAX_NOTE_SIZE_KB * 1024;
  }
  if (configured <= 0) return undefined;
  return Math.floor(configured) * 1024;
}

export function isWithinNoteSizeLimit(bytes: number, limitBytes: number | undefined): boolean {
  return limitBytes === undefined || bytes <= limitBytes;
}
