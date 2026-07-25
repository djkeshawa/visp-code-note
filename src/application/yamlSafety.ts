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
): OffsetTextEdit {
  const lines = propertyTailLines(source, bounds, property);
  const meaningful = lines.filter((line) => !isTrivia(line.text));
  if (meaningful.length === 0) {
    const eol = preferredLineEnding(source);
    return insertion(property.lineEnd, `${eol}  - ${encodedValue}`);
  }
  if (meaningful.length !== lines.length) {
    throw unsupportedYamlError("aliases sequence");
  }

  let indentation: string | undefined;
  for (const line of meaningful) {
    const item = /^([ \t]*)-\s+(.+?)\s*$/.exec(line.text);
    if (!item || !isSimpleScalar(item[2] ?? "")) {
      throw unsupportedYamlError("aliases sequence");
    }
    indentation ??= item[1] ?? "";
    if (item[1] !== indentation) {
      throw unsupportedYamlError("aliases sequence");
    }
  }

  const last = meaningful.at(-1)!;
  return insertion(last.end, `${last.eol}${indentation ?? ""}- ${encodedValue}`);
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
