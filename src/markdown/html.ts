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

function findTagEnd(source: string, start: number): number | undefined {
  let quote: "'" | '"' | undefined;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
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
