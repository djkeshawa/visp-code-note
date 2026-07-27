export function isEscapedAt(source: string, offset: number): boolean {
  let backslashes = 0;
  for (let index = offset - 1; index >= 0 && source[index] === "\\"; index -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

/**
 * Escape state for every offset, in one forward pass.
 *
 * `isEscapedAt` walks backwards over the run of backslashes before the offset, so it costs the
 * length of that run. A caller asking about many offsets in the same document pays that run
 * again at every one, which turns a scan over a backslash-heavy note into quadratic work. The
 * parser runs over whole notes on every keystroke, so it reads this table instead: one pass to
 * build, constant time per lookup, and the same answer at every offset.
 */
export function escapeFlags(source: string): Uint8Array {
  const flags = new Uint8Array(source.length);
  let run = 0;
  for (let index = 0; index < source.length; index += 1) {
    flags[index] = run % 2 === 1 ? 1 : 0;
    run = source[index] === "\\" ? run + 1 : 0;
  }
  return flags;
}

/** Reads the table when the caller has one, and falls back to a direct check when it does not. */
export function escapedAt(
  source: string,
  offset: number,
  flags: Uint8Array | undefined,
): boolean {
  return flags === undefined ? isEscapedAt(source, offset) : flags[offset] === 1;
}
