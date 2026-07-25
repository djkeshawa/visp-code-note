export interface TextPatch {
  readonly start: number;
  readonly end: number;
  readonly source: string;
  readonly expectedSource: string;
}

export function createTextPatch(before: string, after: string): TextPatch | undefined {
  if (before === after) return undefined;

  let start = commonPrefixLength(before, after);
  if (splitsSurrogatePair(before, start) || splitsSurrogatePair(after, start)) {
    start -= 1;
  }

  const availableBefore = before.length - start;
  const availableAfter = after.length - start;
  let suffixLength = commonSuffixLength(before, after, availableBefore, availableAfter);
  const beforeEnd = before.length - suffixLength;
  const afterEnd = after.length - suffixLength;
  if (splitsSurrogatePair(before, beforeEnd) || splitsSurrogatePair(after, afterEnd)) {
    suffixLength -= 1;
  }

  const end = before.length - suffixLength;
  return {
    start,
    end,
    source: after.slice(start, after.length - suffixLength),
    expectedSource: before.slice(start, end),
  };
}

export function applyTextPatch(source: string, patch: TextPatch): string {
  if (
    !Number.isSafeInteger(patch.start) ||
    !Number.isSafeInteger(patch.end) ||
    patch.start < 0 ||
    patch.end < patch.start ||
    patch.end > source.length ||
    source.slice(patch.start, patch.end) !== patch.expectedSource
  ) {
    throw new Error("The text patch does not match its expected source range.");
  }
  return source.slice(0, patch.start) + patch.source + source.slice(patch.end);
}

function commonPrefixLength(left: string, right: string): number {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left[index] === right[index]) index += 1;
  return index;
}

function commonSuffixLength(
  left: string,
  right: string,
  leftLimit: number,
  rightLimit: number,
): number {
  const limit = Math.min(leftLimit, rightLimit);
  let length = 0;
  while (
    length < limit &&
    left[left.length - length - 1] === right[right.length - length - 1]
  ) {
    length += 1;
  }
  return length;
}

function splitsSurrogatePair(value: string, offset: number): boolean {
  if (offset <= 0 || offset >= value.length) return false;
  return isHighSurrogate(value.charCodeAt(offset - 1)) && isLowSurrogate(value.charCodeAt(offset));
}

function isHighSurrogate(value: number): boolean {
  return value >= 0xd800 && value <= 0xdbff;
}

function isLowSurrogate(value: number): boolean {
  return value >= 0xdc00 && value <= 0xdfff;
}
