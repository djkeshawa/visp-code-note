import type { OffsetRange } from "../domain/models";
import { isEscapedAt } from "./escapes";

const bareUrlPattern = /\b(?:https?|ftp|file|mailto|vscode):(?:\/\/)?[^\s<>"'`]+/gi;

export function findMarkdownDestinationRanges(source: string): readonly OffsetRange[] {
  const ranges: OffsetRange[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const labelStart = source[index] === "!" && source[index + 1] === "["
      ? index + 1
      : source[index] === "[" ? index : -1;
    if (labelStart < 0 || source[labelStart + 1] === "[" || isEscapedAt(source, labelStart)) {
      continue;
    }
    const labelEnd = matchingDelimiter(source, labelStart, "[", "]");
    if (labelEnd < 0) continue;

    const destinationStart = labelEnd + 1;
    const opener = source[destinationStart];
    if (opener !== "(" && opener !== "[") continue;
    const destinationEnd = matchingDelimiter(
      source,
      destinationStart,
      opener,
      opener === "(" ? ")" : "]",
    );
    if (destinationEnd < 0) continue;
    ranges.push({ start: index, end: destinationEnd + 1 });
    index = destinationEnd;
  }

  for (const match of source.matchAll(bareUrlPattern)) {
    if (match.index !== undefined) {
      ranges.push({ start: match.index, end: match.index + match[0].length });
    }
  }
  return ranges;
}

function matchingDelimiter(
  source: string,
  start: number,
  opener: string,
  closer: string,
): number {
  let depth = 0;
  let quote: "\"" | "'" | undefined;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (character === "\n" || character === "\r") return -1;
    if (isEscapedAt(source, index)) continue;
    if (opener === "(" && (character === "\"" || character === "'")) {
      quote = quote === character ? undefined : quote ?? character;
      continue;
    }
    if (quote !== undefined) continue;
    if (character === opener) depth += 1;
    if (character === closer && --depth === 0) return index;
  }
  return -1;
}
