import type { OffsetRange } from "../domain/models";
import { escapeFlags } from "./escapes";

const rawTextElements = new Set(["pre", "script", "style", "textarea"]);

interface TagStart {
  readonly name?: string;
  readonly closing: boolean;
}

export function findHtmlTagRanges(
  source: string,
  escaped: Uint8Array = escapeFlags(source),
): readonly OffsetRange[] {
  const ranges: OffsetRange[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    const start = source.indexOf("<", cursor);
    if (start === -1) break;
    const tag = escaped[start] === 1 ? undefined : parseTagStart(source, start);
    const end = tag === undefined ? undefined : findTagEnd(source, start + 1);
    if (tag === undefined || end === undefined) {
      cursor = start + 1;
      continue;
    }

    if (
      tag.name !== undefined &&
      !tag.closing &&
      rawTextElements.has(tag.name) &&
      !/\/\s*>$/.test(source.slice(start, end))
    ) {
      const rawEnd = findRawElementEnd(source, end, tag.name);
      ranges.push({ start, end: rawEnd });
      cursor = rawEnd;
    } else {
      ranges.push({ start, end });
      cursor = end;
    }
  }
  return Object.freeze(ranges);
}

function parseTagStart(source: string, start: number): TagStart | undefined {
  const marker = source[start + 1];
  if (marker === "!" || marker === "?") {
    return { closing: false };
  }

  const closing = marker === "/";
  const nameStart = start + (closing ? 2 : 1);
  const name = /^[A-Za-z][A-Za-z0-9:-]*/.exec(source.slice(nameStart))?.[0];
  if (name === undefined) return undefined;
  const delimiter = source[nameStart + name.length];
  if (delimiter !== undefined && !/[\s/>]/.test(delimiter)) return undefined;
  return { name: name.toLocaleLowerCase(), closing };
}

/**
 * How far past a `<` the closing `>` may be before the `<` is read as ordinary text.
 *
 * CommonMark already refuses a tag containing a blank line, which is the bound that matters for
 * prose, and this is the backstop for a run with no blank line in it at all. Real markup is far
 * inside it: the longest tag a note plausibly carries is an anchor or an image with a long URL.
 */
const MAX_TAG_LENGTH = 1024;

/**
 * The offset just past the `>` that closes this tag, or undefined when the `<` opens no tag.
 *
 * The search is bounded twice over, and both bounds are load-bearing. It used to run to the end
 * of the document, which cost the parser twice.
 *
 * A `<` that merely looks like a tag start — `a<b` in prose is the everyday one — swallowed
 * everything up to the next `>` anywhere in the note into a protected range, and wiki links,
 * tags and block references are all skipped inside those. One inequality in a paragraph silently
 * emptied the rest of the note out of the index, backlinks and graph, with no diagnostic. Ending
 * the search at a blank line is what CommonMark requires of a raw HTML tag anyway, so this is
 * conformance rather than a heuristic.
 *
 * The failure was also unbounded, and `findHtmlTagRanges` retries from the next `<` after one,
 * so a note with many tag-like `<` and no `>` after them was parsed in quadratic time: 672KB of
 * ordinary prose using `<` as "less than" took eleven seconds, on the extension host during
 * indexing and in the editor on every keystroke. The length cap bounds each failure, which
 * bounds the retries.
 */
function findTagEnd(source: string, start: number): number | undefined {
  let quote: "'" | '"' | undefined;
  let sawLineBreak = false;
  let lineIsBlank = true;
  const limit = Math.min(source.length, start + MAX_TAG_LENGTH);
  for (let index = start; index < limit; index += 1) {
    const character = source[index];
    if (character === "\n") {
      if (sawLineBreak && lineIsBlank) return undefined;
      sawLineBreak = true;
      lineIsBlank = true;
      continue;
    }
    if (character !== "\r" && character !== " " && character !== "\t") {
      lineIsBlank = false;
    }
    if (quote !== undefined) {
      if (character === quote) quote = undefined;
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (character === ">") {
      return index + 1;
    }
  }
  return undefined;
}

function findRawElementEnd(source: string, contentStart: number, name: string): number {
  const closing = new RegExp(`</${name}(?=[\\s>])`, "gi");
  closing.lastIndex = contentStart;
  const match = closing.exec(source);
  if (match?.index === undefined) return source.length;
  return findTagEnd(source, match.index + 2) ?? source.length;
}
