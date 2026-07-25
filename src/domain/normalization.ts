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

export function titleToFileName(title: string): string {
  const safeName = title
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");

  return `${safeName || "Untitled"}.md`;
}

export function encodeWikiTarget(value: string): string {
  return value
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => encodeURIComponent(segment).replace(/%20/g, " "))
    .join("/");
}
