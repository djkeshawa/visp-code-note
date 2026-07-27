/**
 * Outline structure for folding: which lines can collapse, and what they collapse.
 *
 * Expressed over plain lines rather than a syntax tree so the rules can be reasoned about
 * and tested directly. Two things fold:
 *
 *   a heading  — everything up to the next heading of the same or higher level
 *   any line   — whatever is indented beneath it, so a bullet collapses its nested items and a
 *                paragraph collapses its indented continuation
 *
 * `@codemirror/lang-markdown` already declares folds for every other block — fenced code,
 * blockquotes, tables — and deliberately excludes headings and lists, which is the gap this
 * fills.
 *
 * Folding is presentation only. Nothing here writes to the document: an outliner that stores
 * `collapsed:: true` in the Markdown puts view state into the user's notes, where it shows up
 * in diffs and in every other editor.
 */

export interface OutlineFold {
  /** First line of the collapsed region, the one carrying the affordance. */
  readonly startLine: number;
  /** Last line included in the collapsed region. */
  readonly endLine: number;
}

const HEADING = /^(\s{0,3})(#{1,6})(\s|$)/;
const FENCE = /^(\s*)(```+|~~~+)/;

/** Lines inside a fenced code block, so a `#` in a shell script is not read as a heading. */
export function fencedLines(lines: readonly string[]): ReadonlySet<number> {
  const fenced = new Set<number>();
  let openMarker: string | undefined;
  for (const [index, line] of lines.entries()) {
    const fence = FENCE.exec(line);
    if (openMarker === undefined) {
      if (fence?.[2] !== undefined) {
        openMarker = fence[2][0];
        fenced.add(index);
      }
      continue;
    }
    fenced.add(index);
    if (fence?.[2] !== undefined && fence[2][0] === openMarker) {
      openMarker = undefined;
    }
  }
  return fenced;
}

function headingLevel(line: string, fenced: boolean): number | undefined {
  if (fenced) return undefined;
  const match = HEADING.exec(line);
  return match?.[2] === undefined ? undefined : match[2].length;
}

function isBlank(line: string): boolean {
  return line.trim() === "";
}

/**
 * Leading whitespace measured in columns, counting a tab as the jump to the next tab stop.
 *
 * Counting characters instead made one tab shallower than two spaces, so a tab-indented child
 * never registered as nested: it had an indent of 1 against a parent's 2, and folding decided
 * there was nothing under the parent at all. CommonMark measures indentation in columns for the
 * same reason, and Markdown written with tabs is ordinary.
 */
const TAB_WIDTH = 4;

export function indentColumns(line: string): number {
  let columns = 0;
  for (const character of line) {
    if (character === " ") columns += 1;
    else if (character === "\t") columns += TAB_WIDTH - (columns % TAB_WIDTH);
    else break;
  }
  return columns;
}

/**
 * The fold starting at `index`, or undefined when that line has nothing to collapse.
 * Trailing blank lines are excluded so folding does not swallow the gap before the next
 * section.
 */
export function outlineFoldAt(
  lines: readonly string[],
  index: number,
  fenced: ReadonlySet<number> = fencedLines(lines),
): OutlineFold | undefined {
  const line = lines[index];
  if (line === undefined) return undefined;

  const level = headingLevel(line, fenced.has(index));
  if (level !== undefined) {
    let end = index;
    for (let scan = index + 1; scan < lines.length; scan += 1) {
      const next = lines[scan]!;
      const nextLevel = headingLevel(next, fenced.has(scan));
      if (nextLevel !== undefined && nextLevel <= level) break;
      if (!isBlank(next)) end = scan;
    }
    return end > index ? { startLine: index, endLine: end } : undefined;
  }

  /*
   * Anything else folds on indentation alone: a list item collapses its nested items, and an
   * ordinary paragraph collapses whatever is indented beneath it. Keying on indentation rather
   * than on a list marker is what makes an outline of plain lines behave like an outline, which
   * is what an outliner user expects after pressing Tab.
   */
  if (isBlank(line) || fenced.has(index)) return undefined;
  const ownIndent = indentColumns(line);
  let end = index;
  for (let scan = index + 1; scan < lines.length; scan += 1) {
    const next = lines[scan]!;
    if (isBlank(next)) continue;
    // A heading closes an enclosing block however deeply it is indented.
    if (headingLevel(next, fenced.has(scan)) !== undefined) break;
    if (indentColumns(next) <= ownIndent) break;
    end = scan;
  }
  return end > index ? { startLine: index, endLine: end } : undefined;
}

/** Every fold in the document, outermost first. Used for fold-all. */
export function outlineFolds(lines: readonly string[]): readonly OutlineFold[] {
  const fenced = fencedLines(lines);
  const folds: OutlineFold[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const fold = outlineFoldAt(lines, index, fenced);
    if (fold !== undefined) folds.push(fold);
  }
  return folds;
}
