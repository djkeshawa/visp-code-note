import type { ChangeSet, Text } from "@codemirror/state";
import { applyTextPatch } from "../../application/textPatch.js";
import type { TextPatch } from "../../application/textPatch.js";
import { editorOffsetToRawOffset } from "./offsetMapping.js";
import type { LineSeparator } from "./offsetMapping.js";

export interface EditorPatchResult {
  readonly patch: TextPatch;
  readonly source: string;
}

export function createEditorPatch(
  changes: ChangeSet,
  afterDocument: Text,
  rawSource: string,
  lineSeparator: LineSeparator,
): EditorPatchResult | undefined {
  let start: number | undefined;
  let end = 0;
  let previousEnd = 0;
  const replacement: string[] = [];

  changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    const rawStart = toRawOffset(rawSource, fromA);
    const rawEnd = toRawOffset(rawSource, toA);
    if (start === undefined) {
      start = rawStart;
    } else {
      replacement.push(rawSource.slice(previousEnd, rawStart));
    }
    replacement.push(afterDocument.sliceString(fromB, toB, lineSeparator));
    previousEnd = rawEnd;
    end = rawEnd;
  });
  if (start === undefined) return undefined;

  const patch: TextPatch = {
    start,
    end,
    source: replacement.join(""),
    expectedSource: rawSource.slice(start, end),
  };
  return { patch, source: applyTextPatch(rawSource, patch) };
}

function toRawOffset(
  source: string,
  editorOffset: number,
): number {
  return source.includes("\r\n")
    ? editorOffsetToRawOffset(source, editorOffset)
    : Math.min(editorOffset, source.length);
}
