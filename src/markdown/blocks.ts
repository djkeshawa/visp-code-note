import type { Heading, MarkdownBlock, OffsetRange } from "../domain/models";
import { createBlock, fromLines } from "./blockFactory";
import {
  consumeFence,
  consumeListItem,
  consumeParagraph,
  isBlockquote,
  isIndentedCode,
  isList,
  isThematicBreak,
  matchAtxHeading,
  matchFenceStart,
  matchSetextHeading,
} from "./blockSyntax";
import { commentLineSpans } from "./comments";
import type { SourceLine } from "./lines";
import { isTaskIdLine, matchTaskLine, taskIdFromSource } from "./tasks";

export interface BlockParseResult {
  readonly blocks: readonly MarkdownBlock[];
  readonly headings: readonly Heading[];
}

export function parseBlocks(
  source: string,
  lines: readonly SourceLine[],
  frontmatterLineCount: number,
  commentRanges: readonly OffsetRange[] = [],
): BlockParseResult {
  const blocks: MarkdownBlock[] = [];
  const headings: Heading[] = [];
  const comments = commentLineSpans(source, lines, commentRanges);
  const commentEndByLine = new Map<number, number>();
  for (const span of comments) {
    for (let line = span.start; line < span.end; line += 1) commentEndByLine.set(line, span.end);
  }
  const commentStarts = new Set(comments.map((span) => span.start));
  let index = addFrontmatterBlock(source, lines, frontmatterLineCount, blocks);

  while (index < lines.length) {
    const line = lines[index];
    if (line === undefined) break;

    const commentEnd = commentEndByLine.get(index);
    if (commentEnd !== undefined) {
      blocks.push(fromLines(source, "code", lines, index, commentEnd));
      index = commentEnd;
      continue;
    }

    if (line.text.trim() === "") {
      const endIndex = consumeWhile(
        lines,
        index + 1,
        (candidate, candidateIndex) =>
          !commentStarts.has(candidateIndex) && candidate.text.trim() === "",
      );
      blocks.push(fromLines(source, "blank", lines, index, endIndex));
      index = endIndex;
      continue;
    }

    const fence = matchFenceStart(line.text);
    if (fence !== undefined) {
      const endIndex = consumeFence(lines, index, fence);
      blocks.push(fromLines(source, "code", lines, index, endIndex));
      index = endIndex;
      continue;
    }

    const atx = matchAtxHeading(line);
    if (atx !== undefined) {
      headings.push(atx);
      blocks.push(createBlock(source, "heading", line.start, line.end, line.number, undefined, atx.level));
      index += 1;
      continue;
    }

    const setext = matchSetextHeading(lines, index);
    if (setext !== undefined) {
      headings.push(setext.heading);
      blocks.push(
        createBlock(
          source,
          "heading",
          line.start,
          setext.endLine.end,
          line.number,
          undefined,
          setext.heading.level,
        ),
      );
      index += 2;
      continue;
    }

    if (isThematicBreak(line.text)) {
      blocks.push(fromLines(source, "thematic-break", lines, index, index + 1));
      index += 1;
      continue;
    }

    const taskMatch = matchTaskLine(line.text);
    if (taskMatch !== undefined) {
      let endIndex = index + 1;
      if (lines[endIndex] !== undefined && isTaskIdLine(lines[endIndex]?.text ?? "")) endIndex += 1;
      const end = lines[endIndex - 1]?.end ?? line.end;
      const taskId = taskIdFromSource(source.slice(line.start, end));
      blocks.push(
        createBlock(
          source,
          "task",
          line.start,
          end,
          line.number,
          taskId === undefined ? undefined : `task:${taskId}`,
          undefined,
          taskMatch.completed,
        ),
      );
      index = endIndex;
      continue;
    }

    if (isBlockquote(line.text)) {
      const endIndex = consumeWhile(
        lines,
        index + 1,
        (candidate, candidateIndex) =>
          !commentStarts.has(candidateIndex) && isBlockquote(candidate.text),
      );
      blocks.push(fromLines(source, "blockquote", lines, index, endIndex));
      index = endIndex;
      continue;
    }

    if (isList(line.text)) {
      const endIndex = consumeListItem(lines, index + 1, commentStarts);
      blocks.push(fromLines(source, "list", lines, index, endIndex));
      index = endIndex;
      continue;
    }

    if (isIndentedCode(line.text)) {
      const endIndex = consumeWhile(
        lines,
        index + 1,
        (candidate, candidateIndex) =>
          !commentStarts.has(candidateIndex) &&
          (isIndentedCode(candidate.text) || candidate.text.trim() === ""),
      );
      blocks.push(fromLines(source, "code", lines, index, endIndex));
      index = endIndex;
      continue;
    }

    const endIndex = consumeParagraph(lines, index + 1, commentStarts);
    blocks.push(fromLines(source, "paragraph", lines, index, endIndex));
    index = endIndex;
  }

  return { blocks: Object.freeze(blocks), headings: Object.freeze(headings) };
}

function addFrontmatterBlock(
  source: string,
  lines: readonly SourceLine[],
  lineCount: number,
  blocks: MarkdownBlock[],
): number {
  const last = lines[lineCount - 1];
  if (lineCount > 0 && last !== undefined) {
    blocks.push(createBlock(source, "code", lines[0]?.start ?? 0, last.end, 0, "frontmatter"));
  }
  return lineCount;
}

function consumeWhile(
  lines: readonly SourceLine[],
  start: number,
  predicate: (line: SourceLine, index: number) => boolean,
): number {
  let index = start;
  while (lines[index] !== undefined && predicate(lines[index] as SourceLine, index)) index += 1;
  return index;
}
