/**
 * The `/` menu: block-level syntax, offered by name.
 *
 * Markdown's block syntax is the part a reader has to remember rather than recognise — a table
 * is four lines of pipes before it is a table, and a callout is a blockquote with a bracketed
 * word in it. Typing `/` names the thing instead and lets the editor write the punctuation.
 *
 * It fires only where a block can start, which is what keeps it out of the way of prose: a `/`
 * inside a sentence, a URL or a date is not a command and never opens a menu.
 *
 * No `@codemirror` import here, so the list and the query are testable without an editor.
 */

/** Where the caret lands inside an expanded template. */
const CARET = "\u0000";
/** Replaced with today's date when the template is expanded. */
const TODAY = "\u0001";
/**
 * Wraps a placeholder that should arrive selected.
 *
 * A sample value with the caret parked in front of it is a trap: `@remind(|15m)` turns into
 * `@remind(1m15m)` the moment the reader types what they actually wanted. Selecting the sample
 * instead means typing replaces it and Tab or an arrow key keeps it.
 */
const SELECT = "\u0002";

export interface SlashCommand {
  readonly id: string;
  readonly label: string;
  /** The syntax it writes, shown in the right-hand column the way a note path is. */
  readonly detail: string;
  /** Extra words that should match it, beyond the label. */
  readonly keywords: readonly string[];
  /** A codicon name, without the `codicon-` prefix. */
  readonly icon: string;
  readonly template: string;
  /**
   * True when the syntax this writes opens a menu of its own — `[[` has a note picker behind
   * it, and stopping at the brackets leaves the reader half-way through the thing they asked
   * for.
   */
  readonly opensCompletion?: true;
}

export interface SlashQuery {
  /** Offset of the `/` within the line. */
  readonly start: number;
  readonly query: string;
}

export const SLASH_COMMANDS: readonly SlashCommand[] = Object.freeze([
  {
    id: "heading-1",
    label: "Heading 1",
    detail: "#",
    keywords: ["h1", "title"],
    icon: "text-size",
    template: `# ${CARET}`,
  },
  {
    id: "heading-2",
    label: "Heading 2",
    detail: "##",
    keywords: ["h2", "section"],
    icon: "text-size",
    template: `## ${CARET}`,
  },
  {
    id: "heading-3",
    label: "Heading 3",
    detail: "###",
    keywords: ["h3", "subsection"],
    icon: "text-size",
    template: `### ${CARET}`,
  },
  {
    id: "bullet-list",
    label: "Bulleted List",
    detail: "-",
    keywords: ["ul", "unordered", "bullet"],
    icon: "list-unordered",
    template: `- ${CARET}`,
  },
  {
    id: "numbered-list",
    label: "Numbered List",
    detail: "1.",
    keywords: ["ol", "ordered", "number"],
    icon: "list-ordered",
    template: `1. ${CARET}`,
  },
  {
    id: "task",
    label: "Task",
    detail: "- [ ]",
    keywords: ["todo", "checkbox", "check"],
    icon: "checklist",
    template: `- [ ] ${CARET}`,
  },
  {
    id: "due",
    label: "Due Date",
    detail: "@due(…)",
    keywords: ["deadline", "date", "when"],
    icon: "calendar",
    template: `@due(${TODAY}${CARET})`,
  },
  {
    id: "remind",
    label: "Reminder",
    detail: "@remind(…)",
    keywords: ["notify", "alert", "before"],
    icon: "bell",
    template: `@remind(${SELECT}15m${SELECT})`,
  },
  {
    id: "priority",
    label: "Priority",
    detail: "@priority(…)",
    keywords: ["high", "medium", "low", "important"],
    icon: "warning",
    template: `@priority(${SELECT}high${SELECT})`,
  },
  {
    id: "code",
    label: "Code Block",
    detail: "```",
    keywords: ["fence", "snippet", "pre"],
    icon: "code",
    template: `\`\`\`${CARET}\n\n\`\`\``,
  },
  {
    id: "table",
    label: "Table",
    detail: "| … |",
    keywords: ["grid", "rows", "columns"],
    icon: "table",
    template: `| ${SELECT}Column${SELECT} | Column |\n| --- | --- |\n|  |  |`,
  },
  {
    id: "callout",
    label: "Callout",
    detail: "> [!NOTE]",
    keywords: ["admonition", "note", "aside", "warning", "tip"],
    icon: "info",
    template: `> [!NOTE]\n> ${CARET}`,
  },
  {
    id: "quote",
    label: "Quote",
    detail: ">",
    keywords: ["blockquote", "cite"],
    icon: "quote",
    template: `> ${CARET}`,
  },
  {
    id: "divider",
    label: "Divider",
    detail: "---",
    keywords: ["rule", "separator", "hr", "break"],
    icon: "horizontal-rule",
    template: "---\n",
  },
  {
    id: "wiki-link",
    label: "Link to Note",
    detail: "[[…]]",
    keywords: ["wiki", "reference", "connect", "backlink"],
    icon: "link",
    template: `[[${CARET}`,
    opensCompletion: true,
  },
  {
    id: "tag",
    label: "Tag",
    detail: "#tag",
    keywords: ["label", "topic"],
    icon: "tag",
    template: `#${CARET}`,
  },
  {
    id: "block-id",
    label: "Block Reference",
    detail: "^id",
    keywords: ["anchor", "block", "id"],
    icon: "bookmark",
    template: `^${CARET}`,
  },
  {
    id: "today",
    label: "Today's Date",
    detail: "YYYY-MM-DD",
    keywords: ["date", "now", "stamp"],
    icon: "clock",
    template: `${TODAY}${CARET}`,
  },
]);

/**
 * The `/…` under the caret, when there is one.
 *
 * A command may only open a block, so the `/` has to sit at the start of the line or after
 * nothing but indentation and a list marker. That rule is the whole reason this can be a
 * completion source at all: `and/or`, `https://`, and `12/08` all contain a slash, and none of
 * them should raise a menu.
 */
export function findSlashQuery(linePrefix: string): SlashQuery | undefined {
  const slash = linePrefix.lastIndexOf("/");
  if (slash === -1) return undefined;

  const query = linePrefix.slice(slash + 1);
  // A command is one word. Anything else means the reader has moved on and left a slash behind.
  if (!/^[\p{L}\p{N}-]*$/u.test(query)) return undefined;

  const before = linePrefix.slice(0, slash);
  return /^[ \t]*(?:(?:[-+*]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?)?$/.test(before)
    ? { start: slash, query }
    : undefined;
}

/** The commands matching a query, best first. */
export function rankSlashCommands(query: string): readonly SlashCommand[] {
  const needle = query.trim().toLocaleLowerCase();
  if (needle === "") return SLASH_COMMANDS;

  const scored: { command: SlashCommand; score: number }[] = [];
  for (const command of SLASH_COMMANDS) {
    const label = command.label.toLocaleLowerCase();
    const score = label.startsWith(needle)
      ? 0
      : command.keywords.some((keyword) => keyword.startsWith(needle))
        ? 1
        : label.includes(needle)
          ? 2
          : command.keywords.some((keyword) => keyword.includes(needle))
            ? 3
            : -1;
    if (score >= 0) scored.push({ command, score });
  }
  // Ties keep the declared order, which is the order the design lists these blocks in.
  return scored
    .sort((left, right) => left.score - right.score)
    .map((entry) => entry.command);
}

export interface SlashInsertion {
  readonly text: string;
  /** Offset within `text` where the caret belongs, or where a selected placeholder starts. */
  readonly caret: number;
  /** End of a placeholder that arrives selected, so typing replaces it. */
  readonly selectionEnd?: number;
}

/** A command's template as text to insert, and where to leave the selection in it. */
export function expandSlashCommand(command: SlashCommand, today: string): SlashInsertion {
  const filled = command.template.split(TODAY).join(today);
  let text = "";
  let caret: number | undefined;
  let selectionEnd: number | undefined;
  for (const character of filled) {
    if (character === CARET || character === SELECT) {
      // The first marker opens the selection, the second closes it; a lone caret is both.
      if (caret === undefined) caret = text.length;
      else selectionEnd = text.length;
      continue;
    }
    text += character;
  }
  return {
    text,
    caret: caret ?? text.length,
    ...(selectionEnd === undefined ? {} : { selectionEnd }),
  };
}

/** Today as `YYYY-MM-DD` in the reader's own zone, which is what `@due(…)` is read against. */
export function localDateKey(date: Date): string {
  return [
    String(date.getFullYear()).padStart(4, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}
