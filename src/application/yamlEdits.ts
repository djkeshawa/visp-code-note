export interface FrontmatterBounds {
  readonly contentStart: number;
  readonly contentEnd: number;
}

export interface YamlProperty {
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly valueStart: number;
  readonly valueEnd: number;
  readonly value: string;
}

export function findFrontmatterBounds(source: string): FrontmatterBounds | undefined {
  const opening = /^(?:\uFEFF)?---[ \t]*\r?\n/.exec(source);
  if (!opening) {
    return undefined;
  }
  const closingPattern = /^(?:---|\.\.\.)[ \t]*\r?$/gm;
  closingPattern.lastIndex = opening[0].length;
  const closing = closingPattern.exec(source);
  return closing?.index === undefined
    ? undefined
    : { contentStart: opening[0].length, contentEnd: closing.index };
}

export function findYamlProperty(
  source: string,
  bounds: FrontmatterBounds,
  key: string,
): YamlProperty | undefined {
  const body = source.slice(bounds.contentStart, bounds.contentEnd);
  const pattern = /^([A-Za-z_][\w-]*)([ \t]*:[ \t]*)(.*)$/gm;
  for (const match of body.matchAll(pattern)) {
    if (match.index === undefined || match[1]?.toLocaleLowerCase() !== key.toLocaleLowerCase()) {
      continue;
    }
    const fullLine = match[0];
    const prefixLength = (match[1]?.length ?? 0) + (match[2]?.length ?? 0);
    const rawValue = match[3] ?? "";
    const commentAt = yamlCommentIndex(rawValue);
    const valueWithSpacing = rawValue.slice(0, commentAt).trimEnd();
    const lineStart = bounds.contentStart + match.index;
    const valueStart = lineStart + prefixLength;
    return {
      lineStart,
      lineEnd: lineStart + fullLine.length,
      valueStart,
      valueEnd: valueStart + valueWithSpacing.length,
      value: valueWithSpacing.trim(),
    };
  }
  return undefined;
}

export function formatYamlScalar(value: string, previous: string): string {
  if (previous.startsWith("'") && previous.endsWith("'")) {
    return `'${value.replace(/'/g, "''")}'`;
  }
  if (previous.startsWith('"') && previous.endsWith('"')) {
    return JSON.stringify(value);
  }
  return /^[\p{L}\p{N}][\p{L}\p{N} _./-]*$/u.test(value) && !isImplicitYamlValue(value)
    ? value
    : JSON.stringify(value);
}

function isImplicitYamlValue(value: string): boolean {
  const normalized = value.trim().toLocaleLowerCase();
  return /^(?:null|~|true|false|yes|no|on|off|\.nan|[+-]?\.inf)$/.test(normalized)
    || /^[+-]?\d[\d_]*(?:\.\d[\d_]*)?(?:e[+-]?\d[\d_]*)?$/.test(normalized)
    || /^0(?:x[\da-f_]+|o[0-7_]+|b[01_]+)$/.test(normalized)
    || /^\d{4}-\d{1,2}-\d{1,2}(?:[t ]|$)/.test(normalized);
}

function yamlCommentIndex(value: string): number {
  let quote: "'" | '"' | undefined;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === quote && (quote === "'" || value[index - 1] !== "\\")) {
        quote = undefined;
      }
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (character === "#" && (index === 0 || /\s/.test(value[index - 1] ?? ""))) {
      return index;
    }
  }
  return value.length;
}
