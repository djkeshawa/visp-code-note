import type { OffsetRange } from "../domain/models";

export interface SourceLine {
  readonly number: number;
  readonly start: number;
  readonly contentEnd: number;
  readonly end: number;
  readonly text: string;
}

export function scanLines(source: string): readonly SourceLine[] {
  const lines: SourceLine[] = [];
  let start = 0;
  let number = 0;

  while (start < source.length) {
    let contentEnd = start;
    while (
      contentEnd < source.length &&
      source.charCodeAt(contentEnd) !== 10 &&
      source.charCodeAt(contentEnd) !== 13
    ) {
      contentEnd += 1;
    }
    let end = contentEnd;
    if (source.charCodeAt(end) === 13 && source.charCodeAt(end + 1) === 10) {
      end += 2;
    } else if (end < source.length) {
      end += 1;
    }

    lines.push({
      number,
      start,
      contentEnd,
      end,
      text: source.slice(start, contentEnd),
    });
    start = end;
    number += 1;
  }

  return lines;
}

export function lineNumberAtOffset(lines: readonly SourceLine[], offset: number): number {
  if (lines.length === 0) {
    return 0;
  }

  let low = 0;
  let high = lines.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const line = lines[middle];
    if (line === undefined) {
      break;
    }
    if (offset < line.start) {
      high = middle - 1;
    } else if (offset >= line.end && middle < lines.length - 1) {
      low = middle + 1;
    } else {
      return line.number;
    }
  }

  return lines[lines.length - 1]?.number ?? 0;
}

export function rangesOverlap(left: OffsetRange, right: OffsetRange): boolean {
  return left.start < right.end && right.start < left.end;
}

export function containsOffset(ranges: readonly OffsetRange[], offset: number): boolean {
  return ranges.some((range) => offset >= range.start && offset < range.end);
}
