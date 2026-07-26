/**
 * Validation for the rendered-prose font family.
 *
 * The value reaches a webview stylesheet, and a window-scoped setting can be supplied by
 * workspace settings — which means by a cloned repository. Visp Notes declares that it
 * supports untrusted workspaces, so this is attacker-controlled input and is treated as
 * such: a strict allow-list of the characters a font stack legitimately needs, rather than
 * an attempt to strip the characters that would be dangerous.
 */
/*
 * Letters of any script, digits, and the punctuation a font stack legitimately needs. Using
 * the Unicode letter class rather than a Latin range means a CJK or Cyrillic font name is
 * accepted without widening the gate: every injection vector — semicolons, braces, brackets,
 * slashes, colons, angle brackets, backslashes — stays excluded.
 */
const ALLOWED = /^[\p{L}\p{N} _\-'",.]+$/u;
const MAX_LENGTH = 200;

export function isUsableProseFont(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_LENGTH && ALLOWED.test(trimmed);
}

/** Returns the font stack to apply, or undefined to inherit the interface font. */
export function parseProseFont(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return isUsableProseFont(trimmed) ? trimmed : undefined;
}
