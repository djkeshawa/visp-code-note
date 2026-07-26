/**
 * Pipe-table structure for live presentation.
 *
 * A table is not turned into an HTML `<table>`. Doing that means replacing several lines with
 * one block widget, which takes the text out of the document the caret moves through — the
 * single invariant this editor is built on. Instead the rows stay editable text and are given
 * the things that make a table readable: a monospace grid so columns line up, a header that
 * reads as a header, quiet separators, and the delimiter row collapsed to a rule when the
 * caret is elsewhere.
 *
 * Classification is line-based and deliberately conservative: a run of lines is only a table
 * when a delimiter row such as `| --- | :-: |` sits directly beneath a header row.
 */

export type TableLineKind = "header" | "delimiter" | "body";

export interface TableLine {
  readonly line: number;
  readonly kind: TableLineKind;
}

const DELIMITER = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;
const FENCE = /^(\s*)(```+|~~~+)/;

function looksLikeRow(line: string): boolean {
  return line.includes("|") && line.trim() !== "";
}

function isDelimiterRow(line: string): boolean {
  return line.includes("-") && DELIMITER.test(line);
}

/**
 * Every line belonging to a pipe table, with its role. Lines inside fenced code are skipped so
 * a table drawn inside a code sample is left alone.
 */
export function tableLines(lines: readonly string[]): readonly TableLine[] {
  const found: TableLine[] = [];
  let openFence: string | undefined;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const fence = FENCE.exec(line);
    if (openFence !== undefined) {
      if (fence?.[2] !== undefined && fence[2][0] === openFence) openFence = undefined;
      continue;
    }
    if (fence?.[2] !== undefined) {
      openFence = fence[2][0];
      continue;
    }

    const delimiter = lines[index + 1];
    if (
      !looksLikeRow(line) ||
      isDelimiterRow(line) ||
      delimiter === undefined ||
      !isDelimiterRow(delimiter)
    ) {
      continue;
    }

    found.push({ line: index, kind: "header" }, { line: index + 1, kind: "delimiter" });
    let body = index + 2;
    while (body < lines.length && looksLikeRow(lines[body]!) && !isDelimiterRow(lines[body]!)) {
      found.push({ line: body, kind: "body" });
      body += 1;
    }
    index = body - 1;
  }
  return found;
}

/** Offsets of every `|` in a row, so separators can be dimmed without touching the text. */
export function pipePositions(line: string): readonly number[] {
  const positions: number[] = [];
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === "|" && line[index - 1] !== "\\") positions.push(index);
  }
  return positions;
}
