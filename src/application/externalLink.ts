/**
 * Which link destinations the editor is willing to hand to the operating system.
 *
 * A note is ordinary workspace content, so its links are untrusted input: a cloned repository
 * can put anything in one. `command:` is the dangerous case — VS Code reads such a URI as an
 * instruction to run a command with arguments — while `file:` would reach arbitrary paths and
 * `javascript:` and `data:` are the usual browser tricks. Rather than name those, only the three
 * schemes a note plausibly links out with are allowed, so anything invented later stays out too.
 */
const OPENABLE_SCHEMES = new Set(["http", "https", "mailto"]);

/** Well past any real URL, and short enough that nothing enormous is handed on. */
const MAX_LENGTH = 2048;

export function parseExternalLink(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const candidate = value.trim();
  if (candidate === "" || candidate.length > MAX_LENGTH) return undefined;
  // Control characters have no place in a URL, and are how a destination hides what it opens.
  for (const character of candidate) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return undefined;
  }

  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(candidate)?.[1]?.toLowerCase();
  if (scheme === undefined || !OPENABLE_SCHEMES.has(scheme)) return undefined;
  return candidate;
}

export function isExternalLink(value: unknown): boolean {
  return parseExternalLink(value) !== undefined;
}
