import type { NoteTask, OffsetRange, TaskPriority } from "../domain/models";
import { createRangeIndex } from "./lines";
import type { SourceLine } from "./lines";
import { collectTagNames, removeTagTokens } from "./tags";

/*
 * Leading whitespace is unbounded rather than capped at three spaces. The cap follows
 * CommonMark, where a fourth space opens an indented code block — but it meant a checkbox
 * nested more than one level deep was not a task at all: absent from the Activity Bar, the
 * Tasks view and the index. Fenced code is excluded separately through protected ranges, so
 * the only thing this over-matches is a checkbox inside an indented code block, which is a
 * far smaller cost than losing a real task.
 */
const taskPattern = /^([ \t]*(?:[-+*]|\d+[.)])[ \t]+\[)([ xX])(\])(?=[ \t]+|$)/;
const taskIdPattern = /<!--\s*task:([A-Za-z0-9][\w.-]*)\s*-->/i;
const duePattern = /@due\(\s*([^)]+?)\s*\)/i;
const remindPattern = /@remind\(\s*([^)]+?)\s*\)/i;
const priorityPattern = /@priority\(\s*(low|medium|high)\s*\)/i;

export interface TaskLineMatch {
  readonly completed: boolean;
  readonly statusOffset: number;
  readonly bodyOffset: number;
}

export function matchTaskLine(text: string): TaskLineMatch | undefined {
  const match = taskPattern.exec(text);
  if (match === null) {
    return undefined;
  }
  const beforeStatus = match[1] ?? "";
  const status = match[2] ?? " ";
  return {
    completed: status.toLocaleLowerCase() === "x",
    statusOffset: beforeStatus.length,
    bodyOffset: beforeStatus.length + status.length + (match[3]?.length ?? 1),
  };
}

export function parseTasks(
  source: string,
  lines: readonly SourceLine[],
  excludedRanges: readonly OffsetRange[],
): readonly NoteTask[] {
  const tasks: NoteTask[] = [];
  /*
   * Built once, the way parseInlineTags and parseBlockReferences already build theirs. Asking
   * `containsOffset` per line walked the whole excluded list every time, so a note's lines and
   * its fenced blocks multiplied: 375KB of alternating fences and tasks took 1.5s, and the cost
   * kept climbing faster than the note did.
   */
  const excluded = createRangeIndex(excludedRanges);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined || excluded.covers(line.start, line.start + 1)) {
      continue;
    }
    const match = matchTaskLine(line.text);
    if (match === undefined) {
      continue;
    }

    const nextLine = lines[index + 1];
    const hasIdLine = nextLine !== undefined && isTaskIdLine(nextLine.text);
    const end = hasIdLine ? nextLine.end : line.end;
    const taskSource = source.slice(line.start, end);
    const body = line.text.slice(match.bodyOffset).trim();
    const due = duePattern.exec(body)?.[1]?.trim();
    const remind = remindPattern.exec(body)?.[1]?.trim();
    const priority = priorityPattern.exec(body)?.[1]?.toLocaleLowerCase() as TaskPriority | undefined;
    const tags = Object.freeze([...collectTagNames(body)]);
    const text = cleanTaskText(body);

    tasks.push({
      ...(taskIdFromSource(taskSource) === undefined ? {} : { id: taskIdFromSource(taskSource) }),
      text,
      completed: match.completed,
      ...(due === undefined || due === "" ? {} : { due }),
      ...(remind === undefined || remind === "" ? {} : { remind }),
      ...(priority === undefined ? {} : { priority }),
      tags,
      range: { start: line.start, end },
      checkboxRange: {
        start: line.start + match.statusOffset,
        end: line.start + match.statusOffset + 1,
      },
      line: line.number,
    });

    if (hasIdLine) {
      index += 1;
    }
  }
  return Object.freeze(tasks);
}

export function taskIdFromSource(source: string): string | undefined {
  return taskIdPattern.exec(source)?.[1];
}

export function isTaskIdLine(text: string): boolean {
  return /^\s*<!--\s*task:[A-Za-z0-9][\w.-]*\s*-->\s*$/i.test(text);
}

function cleanTaskText(body: string): string {
  return removeTagTokens(
    body
      .replace(taskIdPattern, "")
      .replace(duePattern, "")
      .replace(remindPattern, "")
      .replace(priorityPattern, ""),
  )
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
