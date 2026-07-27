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

/**
 * Ranges arranged so that "does anything cover this span?" costs a binary search.
 *
 * Asking that question by walking the whole list is fine once and ruinous per item: a note with
 * a link and a tag on every line has thousands of each, and the walk turns tag extraction into
 * work proportional to links times tags. Overlapping inputs are merged so the search only ever
 * has to look at one candidate.
 */
export interface RangeIndex {
  readonly covers: (start: number, end: number) => boolean;
}

export function createRangeIndex(ranges: readonly OffsetRange[]): RangeIndex {
  const sorted = [...ranges].sort((left, right) => left.start - right.start);
  const merged: OffsetRange[] = [];
  for (const range of sorted) {
    if (range.end <= range.start) continue;
    const last = merged[merged.length - 1];
    if (last !== undefined && range.start <= last.end) {
      if (range.end > last.end) merged[merged.length - 1] = { start: last.start, end: range.end };
      continue;
    }
    merged.push({ start: range.start, end: range.end });
  }

  return {
    covers: (start, end) => {
      // The first range that could reach past `start`; only it can overlap the span.
      let low = 0;
      let high = merged.length - 1;
      let candidate = -1;
      while (low <= high) {
        const middle = (low + high) >> 1;
        if (merged[middle]!.end > start) {
          candidate = middle;
          high = middle - 1;
        } else {
          low = middle + 1;
        }
      }
      if (candidate === -1) return false;
      const range = merged[candidate]!;
      return start < range.end && range.start < end;
    },
  };
}

export function containsOffset(ranges: readonly OffsetRange[], offset: number): boolean {
  return ranges.some((range) => offset >= range.start && offset < range.end);
}
