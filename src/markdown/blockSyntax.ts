import type { Heading } from "../domain/models";
import { slugifyHeading } from "../domain/normalization";
import type { SourceLine } from "./lines";
import { matchTaskLine } from "./tasks";

const listPattern = /^ {0,3}(?:[-+*]|\d+[.)])(?:[ \t]+|$)/;
const blockquotePattern = /^ {0,3}>/;
const indentedCodePattern = /^(?: {4}|\t)/;

export interface Fence {
  readonly marker: "`" | "~";
  readonly length: number;
}

export interface SetextHeading {
  readonly heading: Heading;
  readonly endLine: SourceLine;
}

export function matchAtxHeading(line: SourceLine): Heading | undefined {
  const match = /^ {0,3}(#{1,6})(?:[ \t]+(.*?)|[ \t]*)$/.exec(line.text);
  if (match === null) return undefined;
  const text = (match[2] ?? "").replace(/[ \t]+#+[ \t]*$/, "").trim();
  return {
    level: match[1]?.length ?? 1,
    text,
    slug: slugifyHeading(text),
    range: { start: line.start, end: line.contentEnd },
  };
}

export function matchSetextHeading(
  lines: readonly SourceLine[],
  index: number,
): SetextHeading | undefined {
  const line = lines[index];
  const underline = lines[index + 1];
  if (
    line === undefined ||
    underline === undefined ||
    line.text.trim() === "" ||
    isStandaloneBlockStart(line.text)
  ) {
    return undefined;
  }
  const match = /^ {0,3}(=+|-+)[ \t]*$/.exec(underline.text);
  if (match === null) return undefined;
  const text = line.text.trim();
  return {
    heading: {
      level: match[1]?.startsWith("=") === true ? 1 : 2,
      text,
      slug: slugifyHeading(text),
      range: { start: line.start, end: underline.contentEnd },
    },
    endLine: underline,
  };
}

export function consumeParagraph(
  lines: readonly SourceLine[],
  start: number,
  protectedStarts: ReadonlySet<number> = new Set(),
): number {
  let index = start;
  while (index < lines.length) {
    const line = lines[index];
    if (
      line === undefined ||
      protectedStarts.has(index) ||
      line.text.trim() === "" ||
      isStructuralStart(lines, index)
    ) {
      break;
    }
    index += 1;
  }
  return index;
}

export function consumeListItem(
  lines: readonly SourceLine[],
  start: number,
  protectedStarts: ReadonlySet<number> = new Set(),
): number {
  let index = start;
  while (index < lines.length) {
    const line = lines[index];
    if (line === undefined || protectedStarts.has(index) || line.text.trim() === "") break;
    if (matchTaskLine(line.text) !== undefined || isList(line.text) || isStandaloneBlockStart(line.text)) {
      break;
    }
    if (!/^\s+/.test(line.text)) break;
    index += 1;
  }
  return index;
}

export function matchFenceStart(text: string): Fence | undefined {
  const token = /^ {0,3}(`{3,}|~{3,})/.exec(text)?.[1];
  const marker = token?.[0];
  if (token === undefined || (marker !== "`" && marker !== "~")) return undefined;
  return { marker, length: token.length };
}

export function consumeFence(lines: readonly SourceLine[], start: number, fence: Fence): number {
  const closing = new RegExp(`^ {0,3}\\${fence.marker}{${fence.length},}[ \\t]*$`);
  for (let index = start + 1; index < lines.length; index += 1) {
    if (closing.test(lines[index]?.text ?? "")) return index + 1;
  }
  return lines.length;
}

export function isThematicBreak(text: string): boolean {
  return /^(?: {0,3})(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(text);
}

export function isBlockquote(text: string): boolean {
  return blockquotePattern.test(text);
}

export function isList(text: string): boolean {
  return listPattern.test(text);
}

export function isIndentedCode(text: string): boolean {
  return indentedCodePattern.test(text);
}

/**
 * A list marker at any indentation.
 *
 * `isList` caps indentation at three spaces, which is right at the top level: four spaces
 * there opens an indented code block. Inside a list that cap is wrong, because indentation is
 * measured from the parent item's content offset — so a third-level bullet, which Tab produces
 * at four spaces, was being read as code. Only meaningful while a list is already open.
 */
export function isNestedListContinuation(text: string): boolean {
  return /^[ \t]+(?:[-+*]|\d+[.)])(?:[ \t]+|$)/.test(text);
}

/**
 * Whether a line ends the paragraph running into it.
 *
 * Indentation does not, which is the one case worth spelling out: an indented code block cannot
 * interrupt a paragraph, so the indented lines under a line of prose are continuations of it.
 * Treating them as code meant pressing Tab on a line of prose turned it into a grey code block
 * and cost it the indentation and the fold control that nesting is supposed to give it.
 */
function isStructuralStart(lines: readonly SourceLine[], index: number): boolean {
  const line = lines[index];
  return (
    line !== undefined &&
    (
      isStandaloneBlockStart(line.text, { indentedCodeInterrupts: false }) ||
      matchSetextHeading(lines, index) !== undefined
    )
  );
}

function isStandaloneBlockStart(
  text: string,
  { indentedCodeInterrupts = true }: { indentedCodeInterrupts?: boolean } = {},
): boolean {
  return (
    matchFenceStart(text) !== undefined ||
    /^ {0,3}#{1,6}(?:[ \t]+|$)/.test(text) ||
    isThematicBreak(text) ||
    matchTaskLine(text) !== undefined ||
    isBlockquote(text) ||
    isList(text) ||
    (indentedCodeInterrupts && isIndentedCode(text))
  );
}
