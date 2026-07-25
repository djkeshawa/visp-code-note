const MAX_PREVIEW_LENGTH = 140;

export function sourceSearchSnippet(content: string, offset: number, matchLength: number): string {
  const safeOffset = Math.min(Math.max(offset, 0), content.length);
  const lineStart = previousLineBreak(content, safeOffset) + 1;
  const lineEnd = nextLineBreak(content, safeOffset);
  const visibleMatchLength = Math.min(matchLength, MAX_PREVIEW_LENGTH);
  const desiredStart = safeOffset - Math.floor((MAX_PREVIEW_LENGTH - visibleMatchLength) / 2);
  let start = Math.max(lineStart, desiredStart);
  const end = Math.min(lineEnd, start + MAX_PREVIEW_LENGTH);
  start = Math.max(lineStart, Math.min(start, end - MAX_PREVIEW_LENGTH));

  const snippet = content.slice(start, end).replace(/[\t ]+/gu, " ").trim();
  const prefix = start > lineStart ? "…" : "";
  const suffix = end < lineEnd ? "…" : "";
  return `${prefix}${snippet}${suffix}` || "(empty line)";
}

export function truncateSearchValue(value: string): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length <= MAX_PREVIEW_LENGTH
    ? normalized
    : `${normalized.slice(0, MAX_PREVIEW_LENGTH - 1)}…`;
}

function previousLineBreak(content: string, offset: number): number {
  const searchFrom = Math.max(offset - 1, 0);
  return Math.max(content.lastIndexOf("\n", searchFrom), content.lastIndexOf("\r", searchFrom));
}

function nextLineBreak(content: string, offset: number): number {
  const lineFeed = content.indexOf("\n", offset);
  const carriageReturn = content.indexOf("\r", offset);
  if (lineFeed < 0) return carriageReturn < 0 ? content.length : carriageReturn;
  if (carriageReturn < 0) return lineFeed;
  return Math.min(lineFeed, carriageReturn);
}
