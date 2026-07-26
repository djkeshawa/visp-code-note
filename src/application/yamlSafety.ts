import type { OffsetTextEdit } from "./textEdits";
import type { FrontmatterBounds, YamlProperty } from "./yamlEdits";

const ROOT_PROPERTY = /^[A-Za-z_][\w-]*[ \t]*:/;

export function assertSimpleYamlScalar(
  source: string,
  bounds: FrontmatterBounds,
  property: YamlProperty,
  label: string,
): void {
  if (!isSimpleScalar(property.value) || hasUnsupportedContinuation(source, bounds, property)) {
    throw unsupportedYamlError(label);
  }
}

export function assertSingleLineYamlValue(
  source: string,
  bounds: FrontmatterBounds,
  property: YamlProperty,
  label: string,
): void {
  if (hasUnsupportedContinuation(source, bounds, property)) {
    throw unsupportedYamlError(label);
  }
}

export function assertSimpleInlineYamlSequence(
  source: string,
  bounds: FrontmatterBounds,
  property: YamlProperty,
  label: string,
): void {
  assertSingleLineYamlValue(source, bounds, property, label);
  const items = splitInlineSequence(property.value);
  if (items === undefined || items.some((item) => !isSimpleFlowScalar(item))) {
    throw unsupportedYamlError(label);
  }
}

function isSimpleFlowScalar(value: string): boolean {
  const trimmed = value.trim();
  if (!isSimpleScalar(trimmed)) return false;
  return trimmed.startsWith("'") || trimmed.startsWith('"') || !/[[\]{},]/.test(trimmed);
}

export function planSimpleYamlSequenceAppend(
  source: string,
  bounds: FrontmatterBounds,
  property: YamlProperty,
  encodedValue: string,
  label = "aliases sequence",
): OffsetTextEdit {
  const lines = propertyTailLines(source, bounds, property);
  const meaningful = lines.filter((line) => !isTrivia(line.text));
  if (meaningful.length === 0) {
    const eol = preferredLineEnding(source);
    return insertion(property.lineEnd, `${eol}  - ${encodedValue}`);
  }
  if (meaningful.length !== lines.length) {
    throw unsupportedYamlError(label);
  }

  let indentation: string | undefined;
  for (const line of meaningful) {
    const item = /^([ \t]*)-\s+(.+?)\s*$/.exec(line.text);
    if (!item || !isSimpleScalar(item[2] ?? "")) {
      throw unsupportedYamlError(label);
    }
    indentation ??= item[1] ?? "";
    if (item[1] !== indentation) {
      throw unsupportedYamlError(label);
    }
  }

  const last = meaningful.at(-1)!;
  return insertion(last.end, `${last.eol}${indentation ?? ""}- ${encodedValue}`);
}

/**
 * Deletes one item from a simple block sequence, matching on the decoded scalar so the
 * caller does not have to care how the value was quoted. Returns undefined when the item
 * is absent. Refuses the same shapes the append refuses, so a file this cannot safely edit
 * is never half-edited.
 */
export function planSimpleYamlSequenceRemoval(
  source: string,
  bounds: FrontmatterBounds,
  property: YamlProperty,
  matches: (decoded: string) => boolean,
  label: string,
): OffsetTextEdit | undefined {
  const lines = propertyTailLines(source, bounds, property);
  const meaningful = lines.filter((line) => !isTrivia(line.text));
  if (meaningful.length === 0) return undefined;
  if (meaningful.length !== lines.length) {
    throw unsupportedYamlError(label);
  }

  let start = property.lineEnd;
  for (const line of lines) {
    const item = /^([ \t]*)-\s+(.+?)\s*$/.exec(line.text);
    if (!item || !isSimpleScalar(item[2] ?? "")) {
      throw unsupportedYamlError(label);
    }
    if (matches(decodeYamlScalar(item[2] ?? ""))) {
      // Take the preceding line break with the item so no blank line is left behind.
      return { start, end: line.end, text: "" };
    }
    start = line.end;
  }
  return undefined;
}

/** Reads a simple YAML scalar back to its string value. */
export function decodeYamlScalar(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      return typeof parsed === "string" ? parsed : trimmed;
    } catch {
      return trimmed;
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2) {
    return trimmed.slice(1, -1).replaceAll("''", "'");
  }
  return trimmed;
}

export function readSimpleInlineSequence(value: string): readonly string[] | undefined {
  return splitInlineSequence(value);
}

export function preferredLineEnding(source: string): "\n" | "\r\n" {
  return source.includes("\r\n") ? "\r\n" : "\n";
}

function hasUnsupportedContinuation(
  source: string,
  bounds: FrontmatterBounds,
  property: YamlProperty,
): boolean {
  return propertyTailLines(source, bounds, property).some((line) => !isTrivia(line.text));
}

function propertyTailLines(
  source: string,
  bounds: FrontmatterBounds,
  property: YamlProperty,
): readonly TailLine[] {
  const tail = source.slice(property.lineEnd, bounds.contentEnd);
  const lines: TailLine[] = [];
  const pattern = /(\r\n|\n)([^\r\n]*)/g;
  for (const match of tail.matchAll(pattern)) {
    const text = match[2] ?? "";
    if (ROOT_PROPERTY.test(text)) break;
    const relativeStart = match.index ?? 0;
    lines.push({
      text,
      eol: (match[1] ?? "\n") as "\n" | "\r\n",
      end: property.lineEnd + relativeStart + match[0].length,
    });
  }
  /*
   * The slice stops at the closing fence, so when the property is the last one in the
   * frontmatter the line break before that fence yields a final empty entry. It is an
   * artifact of where the slice ends, not a blank line in the document, and leaving it in
   * made the "no trivia between items" check reject an ordinary sequence such as
   * `aliases:\n  - Old\n---`. A genuine interior blank line still leaves an empty entry
   * behind and is still refused.
   */
  if (lines.at(-1)?.text === "") lines.pop();
  return lines;
}

function isSimpleScalar(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === "") return false;
  const quote = trimmed[0];
  if (quote === "'") return isSingleQuotedScalar(trimmed);
  if (quote === '"') return isDoubleQuotedScalar(trimmed);
  return !"|>{[&*!?%@`".includes(quote ?? "")
    && !/^-(?:\s|$)/.test(trimmed)
    && !/:\s/.test(trimmed);
}

function isSingleQuotedScalar(value: string): boolean {
  for (let index = 1; index < value.length; index += 1) {
    if (value[index] !== "'") continue;
    if (value[index + 1] === "'") index += 1;
    else return index === value.length - 1;
  }
  return false;
}

function isDoubleQuotedScalar(value: string): boolean {
  try {
    return typeof JSON.parse(value) === "string";
  } catch {
    return false;
  }
}

function splitInlineSequence(value: string): readonly string[] | undefined {
  if (!value.startsWith("[") || !value.endsWith("]")) return undefined;
  const body = value.slice(1, -1);
  if (body.trim() === "") return [];
  const items: string[] = [];
  let quote: "'" | '"' | undefined;
  let start = 0;
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    if (quote === "'") {
      if (character === "'" && body[index + 1] === "'") index += 1;
      else if (character === "'") quote = undefined;
    } else if (quote === '"') {
      if (character === '"' && body[index - 1] !== "\\") quote = undefined;
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (character === ",") {
      items.push(body.slice(start, index).trim());
      start = index + 1;
    }
  }
  if (quote !== undefined) return undefined;
  items.push(body.slice(start).trim());
  return items;
}

function isTrivia(value: string): boolean {
  const trimmed = value.trim();
  return trimmed === "" || trimmed.startsWith("#");
}

function insertion(start: number, text: string): OffsetTextEdit {
  return { start, end: start, text };
}

function unsupportedYamlError(label: string): Error {
  return new Error(
    `Visp Notes cannot safely edit the existing YAML ${label}. ` +
    "Convert it to a single-line scalar or a simple sequence and retry.",
  );
}

interface TailLine {
  readonly text: string;
  readonly eol: "\n" | "\r\n";
  readonly end: number;
}
