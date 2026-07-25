import type { BlockReference, OffsetRange } from "../domain/models";
import { rangesOverlap } from "./lines";

const blockReferencePattern = /(^|[\t ])\^([A-Za-z0-9][\w.-]*)[\t ]*(?=\r?$)/gm;

export function parseBlockReferences(
  source: string,
  protectedRanges: readonly OffsetRange[],
): readonly BlockReference[] {
  const references: BlockReference[] = [];
  for (const match of source.matchAll(blockReferencePattern)) {
    if (match.index === undefined || match[2] === undefined) {
      continue;
    }
    const start = match.index + (match[1]?.length ?? 0);
    const range = { start, end: start + match[2].length + 1 };
    if (!protectedRanges.some((candidate) => rangesOverlap(range, candidate))) {
      references.push(Object.freeze({ id: match[2], range: Object.freeze(range) }));
    }
  }
  return Object.freeze(references);
}
