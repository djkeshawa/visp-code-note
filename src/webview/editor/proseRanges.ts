/**
 * The parts of a line that are not English prose.
 *
 * A notes file is mostly not prose: the target of a wiki link is a file name, a tag is an
 * address, inline code is code, a link's destination is a URL, and task markers are syntax.
 * Each is already found elsewhere, so this only collects them.
 *
 * Two callers want slightly different answers and neither should re-derive the list. The
 * spell checker wants everything, including tags — an address is not a word and must never be
 * underlined. The `#` completion wants everything *except* tags, because a tag is the one
 * thing it is there to offer.
 */
import type { EditorState } from "@codemirror/state";
import type { OffsetRange } from "../../domain/models.js";
import { findTags } from "../../markdown/tags.js";
import { markdownInlineCodeRanges, markdownInlineLinks } from "./markdownContext.js";
import { wikiLinkSpans } from "./wikiLinkSpans.js";

/** Everything that is not prose and is not a tag either. */
export function nonTagRanges(
  state: EditorState,
  from: number,
  to: number,
  text: string,
): OffsetRange[] {
  const ranges: OffsetRange[] = [];
  for (const span of wikiLinkSpans(text)) {
    ranges.push({ start: from + span.start, end: from + span.end });
  }
  for (const span of markdownInlineCodeRanges(state, from, to)) {
    ranges.push({ start: span.start, end: span.end });
  }
  for (const link of markdownInlineLinks(state, from, to)) {
    // The label is prose and is checked; the destination is a URL and is not.
    ranges.push({ start: link.labelEnd, end: link.end });
  }
  // `@due(2026-08-14)`, `@priority(high)` and the identifier the extension writes.
  for (const match of text.matchAll(/@(?:due|remind|priority)\([^)]*\)|<!--\s*task:[^>]*-->/gi)) {
    if (match.index === undefined) continue;
    ranges.push({ start: from + match.index, end: from + match.index + match[0].length });
  }
  return ranges;
}

/** The same, plus the tags themselves. */
export function nonProseRanges(
  state: EditorState,
  from: number,
  to: number,
  text: string,
): OffsetRange[] {
  const ranges = nonTagRanges(state, from, to, text);
  for (const tag of findTags(text, from)) {
    ranges.push({ start: tag.start, end: tag.end });
  }
  return ranges;
}
