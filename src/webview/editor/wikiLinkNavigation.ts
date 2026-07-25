export interface WikiLinkAtPosition {
  readonly from: number;
  readonly to: number;
  readonly raw: string;
  readonly target: string;
}

export function findWikiLinkAtPosition(
  line: string,
  position: number,
): WikiLinkAtPosition | undefined {
  for (const match of line.matchAll(/\[\[([^\]\r\n]+)\]\]/g)) {
    if (match.index === undefined || match[1] === undefined) continue;
    const from = match.index;
    const to = from + match[0].length;
    if (isEscapedAt(line, from)) continue;
    if (position < from || position > to) continue;
    const target = beforeAlias(match[1]).trim();
    if (target.length === 0) return undefined;
    return { from, to, raw: match[0], target };
  }
  return undefined;
}

function isEscapedAt(value: string, position: number): boolean {
  let backslashes = 0;
  for (let index = position - 1; index >= 0 && value[index] === "\\"; index -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function beforeAlias(value: string): string {
  const separator = value.indexOf("|");
  return separator === -1 ? value : value.slice(0, separator);
}
