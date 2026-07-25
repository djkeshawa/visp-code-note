export type LineSeparator = "\n" | "\r\n" | "\r";

export function detectLineSeparator(source: string): LineSeparator {
  const match = /\r\n|\r|\n/.exec(source)?.[0];
  return match === "\r\n" || match === "\r" ? match : "\n";
}

export function rawOffsetToEditorOffset(
  source: string,
  offset: number,
): number {
  const target = clampOffset(offset, source.length);
  let rawPosition = 0;
  let editorPosition = 0;
  while (rawPosition < target) {
    if (source[rawPosition] === "\r" && source[rawPosition + 1] === "\n") {
      if (target === rawPosition + 1) {
        return editorPosition + 1;
      }
      rawPosition += 2;
      editorPosition += 1;
    } else {
      rawPosition += 1;
      editorPosition += 1;
    }
  }
  return editorPosition;
}

export function editorOffsetToRawOffset(
  source: string,
  offset: number,
): number {
  const editorLength = rawOffsetToEditorOffset(source, source.length);
  const target = clampOffset(offset, editorLength);
  let rawPosition = 0;
  let editorPosition = 0;
  while (editorPosition < target && rawPosition < source.length) {
    rawPosition += source[rawPosition] === "\r" && source[rawPosition + 1] === "\n" ? 2 : 1;
    editorPosition += 1;
  }
  return rawPosition;
}

function clampOffset(offset: number, maximum: number): number {
  if (!Number.isFinite(offset)) {
    return offset === Number.POSITIVE_INFINITY ? maximum : 0;
  }
  return Math.min(Math.max(0, Math.trunc(offset)), maximum);
}
