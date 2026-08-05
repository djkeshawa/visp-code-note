const markdownExtension = /\.md$/i;
const punctuation = /[^\p{L}\p{N}\s-]/gu;

export function normalizeNoteKey(value: string): string {
  return normalizeKey(value);
}

export function normalizeWikiTarget(value: string): string {
  return normalizeKey(decodeWikiTarget(value));
}

function normalizeKey(value: string): string {
  return value
    .replace(/\\/g, "/")
    .replace(markdownExtension, "")
    .trim()
    .toLocaleLowerCase();
}

export function decodeWikiTarget(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function noteStem(path: string): string {
  const name = path.replace(/\\/g, "/").split("/").pop() ?? path;
  return name.replace(markdownExtension, "");
}

export function slugifyHeading(value: string): string {
  return value
    .normalize("NFKD")
    .toLocaleLowerCase()
    .replace(punctuation, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

/**
 * Names Windows will not give a file, whatever extension follows them.
 *
 * These are device names, so `CON.md` is refused by the file system itself. A note titled "con"
 * or "aux" is perfectly reasonable — they are ordinary words — and the failure it produced was
 * an opaque error from the create call rather than anything about the title.
 */
const RESERVED_DEVICE_NAMES = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export function titleToFileName(title: string): string {
  const safeName = title
    .normalize("NFKC")
    /*
     * Control characters, NUL first among them. A title comes from a note's own text or from
     * a wiki link, so a cloned repository picks it. Node refuses a path containing NUL rather
     * than truncating at it the way C does, so this was never a way out of the workspace —
     * but it turned a link into an unexplained failure deep in the file system layer instead
     * of a file with a slightly tidied name.
     */
    // eslint-disable-next-line no-control-regex -- matching control characters is the point
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");

  if (safeName === "") return "Untitled.md";
  // The note keeps its title; only the file it lands in is nudged out of the way.
  return RESERVED_DEVICE_NAMES.test(safeName) ? `${safeName}_.md` : `${safeName}.md`;
}

export function encodeWikiTarget(value: string): string {
  return value
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => encodeURIComponent(segment).replace(/%20/g, " "))
    .join("/");
}
