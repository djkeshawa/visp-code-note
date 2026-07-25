import type { OffsetRange } from "../domain/models";
import { lineNumberAtOffset } from "./lines";
import type { SourceLine } from "./lines";

export interface CommentLineSpan {
  readonly start: number;
  readonly end: number;
}

export function findHtmlCommentRanges(source: string): readonly OffsetRange[] {
  const ranges: OffsetRange[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    const start = source.indexOf("<!--", cursor);
    if (start === -1) break;
    const closing = source.indexOf("-->", start + 4);
    const end = closing === -1 ? source.length : closing + 3;
    ranges.push({ start, end });
    if (end === source.length) break;
    cursor = end;
  }
  return Object.freeze(ranges);
}

export function commentLineSpans(
  source: string,
  lines: readonly SourceLine[],
  ranges: readonly OffsetRange[],
): readonly CommentLineSpan[] {
  const spans = ranges
    .map((range) => toLineSpan(source, lines, range))
    .filter((span): span is CommentLineSpan => span !== undefined)
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const merged: CommentLineSpan[] = [];
  for (const span of spans) {
    const previous = merged[merged.length - 1];
    if (previous !== undefined && span.start <= previous.end) {
      merged[merged.length - 1] = { start: previous.start, end: Math.max(previous.end, span.end) };
    } else {
      merged.push(span);
    }
  }
  return Object.freeze(merged);
}

function toLineSpan(
  source: string,
  lines: readonly SourceLine[],
  range: OffsetRange,
): CommentLineSpan | undefined {
  if (lines.length === 0) return undefined;
  const start = lineNumberAtOffset(lines, range.start);
  const endLine = lineNumberAtOffset(lines, Math.max(range.start, range.end - 1));
  const first = lines[start];
  const last = lines[endLine];
  if (first === undefined || last === undefined) return undefined;

  const spansLines = start !== endLine;
  const occupiesLine =
    source.slice(first.start, range.start).trim() === "" &&
    source.slice(range.end, last.contentEnd).trim() === "";
  return spansLines || occupiesLine ? { start, end: endLine + 1 } : undefined;
}
