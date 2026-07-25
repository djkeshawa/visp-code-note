export interface RelativeTextRange {
  readonly start: number;
  readonly end: number;
}

export function wikiLinkDisplayRange(
  raw: string,
  displayAlias: boolean,
): RelativeTextRange | undefined {
  if (!raw.startsWith("[[") || !raw.endsWith("]]")) return undefined;
  const body = raw.slice(2, -2);
  const separator = body.indexOf("|");
  const segmentStart = displayAlias && separator !== -1 ? separator + 1 : 0;
  const segmentEnd = !displayAlias && separator !== -1 ? separator : body.length;
  const segment = body.slice(segmentStart, segmentEnd);
  const leadingWhitespace = segment.length - segment.trimStart().length;
  const trailingWhitespace = segment.length - segment.trimEnd().length;
  const start = 2 + segmentStart + leadingWhitespace;
  const end = 2 + segmentEnd - trailingWhitespace;
  return start < end ? { start, end } : undefined;
}
