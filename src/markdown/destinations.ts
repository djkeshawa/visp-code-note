import type { OffsetRange } from "../domain/models";
import { escapeFlags } from "./escapes";

const bareUrlPattern = /\b(?:https?|ftp|file|mailto|vscode):(?:\/\/)?[^\s<>"'`]+/gi;

/**
 * How far a `(…)` destination is followed before it is given up on.
 *
 * Unlike a label, a destination cannot be paired off in a single pass: the scan skips whatever
 * sits inside quotes, so where it ends depends on where it began. Without a bound, a line of
 * `[a](` repeated makes every one of them scan to the end of the line, which is quadratic. These
 * ranges only exist to stop wiki links and tags being read out of a destination, so abandoning
 * one that runs longer than any real URL costs nothing but the protection of that one span.
 */
const DESTINATION_SCAN_LIMIT = 2048;

export function findMarkdownDestinationRanges(
  source: string,
  escaped: Uint8Array = escapeFlags(source),
): readonly OffsetRange[] {
  const ranges: OffsetRange[] = [];
  const labels = bracketPairs(source, escaped);
  const destinations = parenPairs(source, escaped);
  const census = censusLines(source);
  let line = 0;

  for (let index = 0; index < source.length; index += 1) {
    // The scan only moves forwards, so the line it is on can be tracked rather than searched.
    while (line + 1 < census.starts.length && index >= census.starts[line + 1]!) line += 1;
    const labelStart = source[index] === "!" && source[index + 1] === "["
      ? index + 1
      : source[index] === "[" ? index : -1;
    if (labelStart < 0 || source[labelStart + 1] === "[" || escaped[labelStart] === 1) {
      continue;
    }
    const labelEnd = labels.get(labelStart);
    if (labelEnd === undefined) continue;

    const destinationStart = labelEnd + 1;
    const opener = source[destinationStart];
    if (opener !== "(" && opener !== "[") continue;
    /*
     * Quotes are the only reason a destination cannot be paired off in the same single pass as
     * a label: the scan skips what sits inside them, so the outcome depends on where it began.
     * On a line with no quote the two agree exactly, so the paired answer is used — which is
     * what keeps a line of unclosed destinations linear. Only a quoted line pays for a scan.
     */
    const destinationEnd = opener === "["
      ? labels.get(destinationStart) ?? -1
      : census.hasQuote[line] !== 1
        ? destinations.get(destinationStart) ?? -1
        // A scan can only end on a `)`, so one cannot help past the last one on the line.
        : destinationStart > (census.lastClose[line] ?? -1)
          ? -1
          : matchingParen(source, destinationStart, escaped);
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

/**
 * Every `[` paired with the `]` that closes it, for the whole document at once.
 *
 * Pairing brackets off with a stack costs one pass. Asking the question separately for each
 * opening bracket costs a scan to the end of the line every time one has no partner, so a line
 * of unclosed brackets used to take time quadratic in its length.
 */
function bracketPairs(source: string, escaped: Uint8Array): ReadonlyMap<number, number> {
  const pairs = new Map<number, number>();
  const open: number[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    // A destination never spans a line break, so nothing stays open across one.
    if (character === "\n" || character === "\r") {
      open.length = 0;
      continue;
    }
    if (escaped[index] === 1) continue;
    if (character === "[") {
      open.push(index);
    } else if (character === "]") {
      const start = open.pop();
      if (start !== undefined) pairs.set(start, index);
    }
  }
  return pairs;
}

/** Every `(` paired with its `)`, counted the same way but without the quote rule. */
function parenPairs(source: string, escaped: Uint8Array): ReadonlyMap<number, number> {
  const pairs = new Map<number, number>();
  const open: number[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === "\n" || character === "\r") {
      open.length = 0;
      continue;
    }
    if (escaped[index] === 1) continue;
    if (character === "(") {
      open.push(index);
    } else if (character === ")") {
      const start = open.pop();
      if (start !== undefined) pairs.set(start, index);
    }
  }
  return pairs;
}

interface LineCensus {
  /** Offset each line starts at. */
  readonly starts: readonly number[];
  /** 1 where that line holds a `"` or `'`. */
  readonly hasQuote: Uint8Array;
  /** Offset of the last `)` on each line, or -1. */
  readonly lastClose: readonly number[];
}

function censusLines(source: string): LineCensus {
  const starts: number[] = [0];
  const flags: number[] = [0];
  const lastClose: number[] = [-1];
  let current = 0;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === "\n") {
      starts.push(index + 1);
      flags.push(0);
      lastClose.push(-1);
      current += 1;
    } else if (character === "\"" || character === "'") {
      flags[current] = 1;
    } else if (character === ")") {
      lastClose[current] = index;
    }
  }
  return { starts, hasQuote: Uint8Array.from(flags), lastClose };
}

/** The `)` closing a destination, skipping anything quoted inside it. */
function matchingParen(source: string, start: number, escaped: Uint8Array): number {
  let depth = 0;
  let quote: "\"" | "'" | undefined;
  const end = Math.min(source.length, start + DESTINATION_SCAN_LIMIT);
  for (let index = start; index < end; index += 1) {
    const character = source[index];
    if (character === "\n" || character === "\r") return -1;
    if (escaped[index] === 1) continue;
    if (character === "\"" || character === "'") {
      quote = quote === character ? undefined : quote ?? character;
      continue;
    }
    if (quote !== undefined) continue;
    if (character === "(") depth += 1;
    if (character === ")" && --depth === 0) return index;
  }
  return -1;
}
