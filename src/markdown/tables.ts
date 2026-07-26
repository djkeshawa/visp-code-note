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

export interface TableCell {
  /** Offsets of the cell's content within the line, excluding the surrounding pipes. */
  readonly start: number;
  readonly end: number;
  readonly column: number;
}

export interface TableBlock {
  readonly startLine: number;
  readonly endLine: number;
  /** Widest content in each column, in characters, used to line the columns up. */
  readonly columnWidths: readonly number[];
}

/**
 * Cells of one row. Monospace alone does not align a table: the columns only line up if the
 * author happened to pad the source, which nobody does. Knowing each cell's extent lets the
 * renderer give it a width instead.
 */
export function rowCells(line: string): readonly TableCell[] {
  const pipes = pipePositions(line);
  if (pipes.length === 0) return [];
  const cells: TableCell[] = [];
  // A leading pipe opens the first cell; without one the row starts at the line beginning.
  const bounds = line.slice(0, pipes[0]).trim() === "" ? pipes : [-1, ...pipes];
  for (let index = 0; index < bounds.length - 1; index += 1) {
    cells.push({ start: bounds[index]! + 1, end: bounds[index + 1]!, column: index });
  }
  const lastPipe = bounds[bounds.length - 1]!;
  if (line.slice(lastPipe + 1).trim() !== "") {
    cells.push({ start: lastPipe + 1, end: line.length, column: bounds.length - 1 });
  }
  return cells;
}

/** Tables grouped into blocks, each carrying the column widths its rows should share. */
export function tableBlocks(lines: readonly string[]): readonly TableBlock[] {
  const blocks: TableBlock[] = [];
  const entries = tableLines(lines);
  let index = 0;
  while (index < entries.length) {
    const start = entries[index]!.line;
    let end = start;
    const widths: number[] = [];
    while (index < entries.length && entries[index]!.line === end) {
      const entry = entries[index]!;
      // The delimiter row is hidden, so its dashes must not set a column's width.
      if (entry.kind !== "delimiter") {
        for (const cell of rowCells(lines[entry.line]!)) {
          const text = lines[entry.line]!.slice(cell.start, cell.end).trim();
          widths[cell.column] = Math.max(widths[cell.column] ?? 0, text.length);
        }
      }
      index += 1;
      end += 1;
    }
    blocks.push({ startLine: start, endLine: end - 1, columnWidths: widths });
  }
  return blocks;
}

/** Offsets of every `|` in a row, so separators can be dimmed without touching the text. */
export function pipePositions(line: string): readonly number[] {
  const positions: number[] = [];
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === "|" && line[index - 1] !== "\\") positions.push(index);
  }
  return positions;
}
