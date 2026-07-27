import type { BlockReference, OffsetRange } from "../domain/models";
import { createRangeIndex } from "./lines";

const blockReferencePattern = /(^|[\t ])\^([A-Za-z0-9][\w.-]*)[\t ]*(?=\r?$)/gm;

export function parseBlockReferences(
  source: string,
  protectedRanges: readonly OffsetRange[],
): readonly BlockReference[] {
  const references: BlockReference[] = [];
  const protection = createRangeIndex(protectedRanges);
  for (const match of source.matchAll(blockReferencePattern)) {
    if (match.index === undefined || match[2] === undefined) {
      continue;
    }
    const start = match.index + (match[1]?.length ?? 0);
    const range = { start, end: start + match[2].length + 1 };
    if (!protection.covers(range.start, range.end)) {
      references.push(Object.freeze({ id: match[2], range: Object.freeze(range) }));
    }
  }
  return Object.freeze(references);
}
