import type { MarkdownBlock, MarkdownBlockKind, OffsetRange } from "../domain/models";
import type { SourceLine } from "./lines";

export function fromLines(
  source: string,
  kind: MarkdownBlockKind,
  lines: readonly SourceLine[],
  startIndex: number,
  endIndex: number,
): MarkdownBlock {
  const first = lines[startIndex];
  const last = lines[endIndex - 1];
  return createBlock(
    source,
    kind,
    first?.start ?? source.length,
    last?.end ?? first?.end ?? source.length,
    first?.number ?? 0,
  );
}

export function createBlock(
  source: string,
  kind: MarkdownBlockKind,
  start: number,
  end: number,
  line: number,
  preferredId?: string,
  headingLevel?: number,
  completed?: boolean,
): MarkdownBlock {
  const blockSource = source.slice(start, end);
  const explicitId = /(?:^|\s)\^([A-Za-z0-9][\w-]*)\s*$/.exec(blockSource.trimEnd())?.[1];
  const semanticId = preferredId ?? explicitId;
  return {
    id: semanticId === "frontmatter"
      ? semanticId
      : semanticId === undefined
        ? `${kind}:${start}`
        : `${semanticId}@${start}`,
    kind,
    source: blockSource,
    range: { start, end } satisfies OffsetRange,
    line,
    ...(headingLevel === undefined ? {} : { headingLevel }),
    ...(completed === undefined ? {} : { completed }),
  };
}
