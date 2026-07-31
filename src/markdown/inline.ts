import type { OffsetRange, WikiLink } from "../domain/models";
import type { Fence } from "./blockSyntax";
import { matchFenceStart } from "./blockSyntax";
import { findHtmlCommentRanges } from "./comments";
import { escapeFlags } from "./escapes";
import { findHtmlTagRanges } from "./html";
import { findMarkdownDestinationRanges } from "./destinations";
import { createRangeIndex, scanLines } from "./lines";
import { findTags, mergeTagNames } from "./tags";

export function collectProtectedRanges(
  source: string,
  structuralRanges: readonly OffsetRange[],
  commentRanges: readonly OffsetRange[] = findHtmlCommentRanges(source),
  escaped: Uint8Array = escapeFlags(source),
): readonly OffsetRange[] {
  const ranges: OffsetRange[] = [
    ...structuralRanges,
    ...commentRanges,
    ...findQuotedFenceRanges(source),
    ...findHtmlTagRanges(source, escaped),
    ...findMarkdownDestinationRanges(source, escaped),
  ];

  let offset = 0;
  while (offset < source.length) {
    if (source[offset] !== "`") {
      offset += 1;
      continue;
    }
    const openingStart = offset;
    while (source[offset] === "`") {
      offset += 1;
    }
    const marker = source.slice(openingStart, offset);
    const closingStart = source.indexOf(marker, offset);
    if (closingStart === -1 || /[\r\n]/.test(source.slice(offset, closingStart))) {
      continue;
    }
    ranges.push({ start: openingStart, end: closingStart + marker.length });
    offset = closingStart + marker.length;
  }

  return Object.freeze(ranges.sort((left, right) => left.start - right.start || left.end - right.end));
}

export function parseWikiLinks(
  source: string,
  protectedRanges: readonly OffsetRange[],
  escaped: Uint8Array = escapeFlags(source),
): readonly WikiLink[] {
  const links: WikiLink[] = [];
  const protection = createRangeIndex(protectedRanges);
  /*
   * Paired off in one forward pass rather than matched with `/\[\[([^\]\r\n]+)\]\]/g`.
   *
   * That pattern consumed the rest of the line after every `[[` and then gave it all back when
   * no `]]` followed, and the scan began again one character later, so a line carrying many
   * unclosed `[[` was quadratic: eight thousand of them took 161ms and the cost quadrupled with
   * every doubling. This is the same shape `bracketPairs` in destinations.ts already pairs off
   * in a single pass, and the same one test/markdown/parserScaling.test.ts pins elsewhere.
   *
   * A body holds no `]` and never spans a line break, so the earliest `[[` since the last of
   * either is the one a `]]` closes — which is the leftmost match the pattern took.
   */
  let opening: number | undefined;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === "\n" || character === "\r") {
      opening = undefined;
      continue;
    }
    if (character === "[" && source[index + 1] === "[") {
      if (opening === undefined) opening = index;
      index += 1;
      continue;
    }
    if (character !== "]") continue;

    // Either this closes the pending opening or it ends it: a body cannot hold a `]`.
    if (source[index + 1] !== "]" || opening === undefined || index <= opening + 2) {
      opening = undefined;
      continue;
    }
    const start = opening;
    const body = source.slice(start + 2, index);
    opening = undefined;
    index += 1;
    if (escaped[start] === 1) {
      continue;
    }
    const range = { start, end: index + 1 };
    if (protection.covers(range.start, range.end)) {
      continue;
    }
    const parsed = parseWikiBody(body);
    if (parsed === undefined) {
      continue;
    }
    links.push({ raw: source.slice(range.start, range.end), ...parsed, range });
  }
  return Object.freeze(links);
}

export function parseInlineTags(
  source: string,
  protectedRanges: readonly OffsetRange[],
  links: readonly WikiLink[],
): readonly string[] {
  /*
   * Built once. Rebuilding the combined list inside the filter meant every tag walked every
   * protected range and every link, so a note with a link and a tag on each line spent most of
   * its parse here — 2.5s on half a megabyte of ordinary prose.
   */
  const excluded = createRangeIndex([...protectedRanges, ...links.map((link) => link.range)]);
  const tags = findTags(source)
    .filter((tag) => !excluded.covers(tag.start, tag.end))
    .map((tag) => tag.name);
  return mergeTagNames(tags);
}

function parseWikiBody(body: string): Omit<WikiLink, "raw" | "range"> | undefined {
  const pipe = body.indexOf("|");
  const destination = (pipe === -1 ? body : body.slice(0, pipe)).trim();
  const alias = pipe === -1 ? undefined : body.slice(pipe + 1).trim();
  if (destination === "" && (alias === undefined || alias === "")) {
    return undefined;
  }

  const headingMarker = destination.indexOf("#");
  const blockMarker = destination.indexOf("^");
  const firstReference = minimumPositive(headingMarker, blockMarker);
  const target = (firstReference === -1 ? destination : destination.slice(0, firstReference)).trim();
  let heading: string | undefined;
  let blockId: string | undefined;

  if (headingMarker !== -1 && (blockMarker === -1 || headingMarker < blockMarker)) {
    const end = blockMarker === -1 ? destination.length : blockMarker;
    heading = destination.slice(headingMarker + 1, end).trim() || undefined;
  }
  if (blockMarker !== -1) {
    blockId = destination.slice(blockMarker + 1).trim() || undefined;
  }

  return {
    target,
    ...(heading === undefined ? {} : { heading }),
    ...(blockId === undefined ? {} : { blockId }),
    ...(alias === undefined || alias === "" ? {} : { alias }),
  };
}

function minimumPositive(left: number, right: number): number {
  if (left === -1) {
    return right;
  }
  if (right === -1) {
    return left;
  }
  return Math.min(left, right);
}

function findQuotedFenceRanges(source: string): readonly OffsetRange[] {
  const lines = scanLines(source);
  const ranges: OffsetRange[] = [];
  let index = 0;
  while (index < lines.length) {
    const openingLine = lines[index];
    const opening = openingLine === undefined ? undefined : quotedFenceStart(openingLine.text);
    if (openingLine === undefined || opening === undefined) {
      index += 1;
      continue;
    }

    let endIndex = index + 1;
    while (endIndex < lines.length) {
      const content = stripQuoteDepth(lines[endIndex]?.text ?? "", opening.depth);
      if (content === undefined) break;
      endIndex += 1;
      if (isFenceClosing(content, opening.fence)) break;
    }
    ranges.push({
      start: openingLine.start,
      end: lines[endIndex - 1]?.end ?? openingLine.end,
    });
    index = endIndex;
  }
  return ranges;
}

function quotedFenceStart(text: string): { readonly depth: number; readonly fence: Fence } | undefined {
  let content = text;
  let depth = 0;
  while (true) {
    const marker = /^ {0,3}>[ \t]?/.exec(content)?.[0];
    if (marker === undefined) break;
    content = content.slice(marker.length);
    depth += 1;
  }
  const fence = depth === 0 ? undefined : matchFenceStart(content);
  return fence === undefined ? undefined : { depth, fence };
}

function stripQuoteDepth(text: string, depth: number): string | undefined {
  let content = text;
  for (let level = 0; level < depth; level += 1) {
    const marker = /^ {0,3}>[ \t]?/.exec(content)?.[0];
    if (marker === undefined) return undefined;
    content = content.slice(marker.length);
  }
  return content;
}

function isFenceClosing(text: string, fence: Fence): boolean {
  const marker = fence.marker === "`" ? "`" : "~";
  return new RegExp(`^ {0,3}${marker}{${fence.length},}[ \\t]*$`).test(text);
}
