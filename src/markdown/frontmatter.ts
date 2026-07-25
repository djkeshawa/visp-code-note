import type { OffsetRange } from "../domain/models";
import type { SourceLine } from "./lines";

type FrontmatterValue = string | readonly string[];

export interface FrontmatterResult {
  readonly data?: Readonly<Record<string, FrontmatterValue>>;
  readonly range?: OffsetRange;
  readonly lineCount: number;
}

export function parseFrontmatter(lines: readonly SourceLine[]): FrontmatterResult {
  const first = lines[0];
  if (first === undefined || first.text.replace(/^\uFEFF/, "").trim() !== "---") {
    return { lineCount: 0 };
  }

  let closingIndex = -1;
  for (let index = 1; index < lines.length; index += 1) {
    const marker = lines[index]?.text.trim();
    if (marker === "---" || marker === "...") {
      closingIndex = index;
      break;
    }
  }
  if (closingIndex === -1) {
    return { lineCount: 0 };
  }

  const values: Record<string, FrontmatterValue> = {};
  let listKey: string | undefined;
  for (let index = 1; index < closingIndex; index += 1) {
    const text = lines[index]?.text ?? "";
    const listItem = /^\s*-\s+(.*?)\s*$/.exec(text);
    if (listKey !== undefined && listItem !== null) {
      const current = values[listKey];
      const item = parseScalar(listItem[1] ?? "");
      values[listKey] = [...(Array.isArray(current) ? current : []), item];
      continue;
    }

    const property = /^([A-Za-z_][\w-]*)\s*:\s*(.*?)\s*$/.exec(text);
    if (property === null) {
      if (text.trim() !== "" && !text.trimStart().startsWith("#")) {
        listKey = undefined;
      }
      continue;
    }

    const key = (property[1] ?? "").toLocaleLowerCase();
    const rawValue = property[2] ?? "";
    if (rawValue === "") {
      values[key] = [];
      listKey = key;
    } else {
      values[key] = parseValue(rawValue);
      listKey = undefined;
    }
  }

  const closing = lines[closingIndex];
  for (const [key, value] of Object.entries(values)) {
    if (Array.isArray(value)) {
      values[key] = Object.freeze([...value]);
    }
  }
  return {
    data: Object.freeze(values),
    range: { start: first.start, end: closing?.end ?? first.end },
    lineCount: closingIndex + 1,
  };
}

function parseValue(value: string): FrontmatterValue {
  const withoutComment = stripComment(value).trim();
  if (withoutComment.startsWith("[") && withoutComment.endsWith("]")) {
    return Object.freeze(splitInlineList(withoutComment.slice(1, -1)).map(parseScalar));
  }
  return parseScalar(withoutComment);
}

function parseScalar(value: string): string {
  const trimmed = stripComment(value).trim();
  if (trimmed.length < 2) {
    return trimmed;
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      return typeof parsed === "string" ? parsed : trimmed.slice(1, -1);
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function splitInlineList(value: string): string[] {
  const items: string[] = [];
  let quote: "'" | '"' | undefined;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote !== undefined) {
      if (character === quote && (quote === "'" || value[index - 1] !== "\\")) {
        quote = undefined;
      }
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (character === ",") {
      items.push(value.slice(start, index));
      start = index + 1;
    }
  }
  const finalItem = value.slice(start);
  if (finalItem.trim() !== "" || items.length > 0) {
    items.push(finalItem);
  }
  return items;
}

function stripComment(value: string): string {
  let quote: "'" | '"' | undefined;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote !== undefined) {
      if (character === quote && (quote === "'" || value[index - 1] !== "\\")) {
        quote = undefined;
      }
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
    } else if (character === "#" && (index === 0 || /\s/.test(value[index - 1] ?? ""))) {
      return value.slice(0, index);
    }
  }
  return value;
}
