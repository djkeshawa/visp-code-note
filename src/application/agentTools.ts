import type { IndexSnapshot, NoteRecord } from "../domain/models";
import {
  describeLinkPath,
  describeNeighbourhood,
  describeNote,
  describeSearch,
  describeTasks,
  resolveNoteReference,
  unknownNote,
} from "./agentContext";
import type { TaskQuery } from "./agentContext";

/**
 * The agent tools, once, for every host that offers them.
 *
 * VS Code's language-model tools (Copilot's agent mode) and the MCP server (Claude Code, Cursor
 * and any other MCP client) answer the same questions from the same index, so the behaviour and
 * the descriptions live here and each host only adapts the transport. Inputs arrive as
 * whatever JSON a model produced, so every field is checked rather than trusted.
 */

export type AgentToolName =
  | "activeNote"
  | "readNote"
  | "searchNotes"
  | "noteGraph"
  | "linkPath"
  | "listTasks";

export interface AgentToolContext {
  readonly snapshot: IndexSnapshot;
  /** Today as YYYY-MM-DD in the reader's time zone, for due-date buckets. */
  readonly today: string;
  /** The note open in the editor, with its current (possibly unsaved) text. Absent outside an editor. */
  readonly active?: { readonly note: NoteRecord; readonly content: string };
  /** The current text of a note if an editor holds it open, so unsaved edits are what is read. */
  readonly openText?: (note: NoteRecord) => string | undefined;
}

const NOTE_REFERENCE = {
  type: "string",
  description: "The note's title, alias, workspace-relative path (for example `notes/ideas.md`), or wiki-link text.",
} as const;

export interface AgentToolDefinition {
  readonly name: AgentToolName;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

export const AGENT_TOOLS: readonly AgentToolDefinition[] = [
  {
    name: "activeNote",
    title: "Open note",
    description: "Returns the Markdown note the user currently has open in the editor, with its workspace path, tags, outline, the notes it links to, the notes that link to it with context, its tasks, and its full current text including unsaved edits. Call this first whenever the user says 'this note', 'my note', 'the current file' or similar and no file is attached.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "readNote",
    title: "Read note",
    description: "Reads one note from the user's Visp Notes workspace by title, alias, path or [[wiki link]] text. Returns its path, tags, outline, outgoing links (and which do not resolve), backlinks with the sentence that mentions it, tasks, and full text. Prefer this over reading the file directly when you need to know how the note connects to others.",
    inputSchema: { type: "object", properties: { note: NOTE_REFERENCE }, required: ["note"] },
  },
  {
    name: "searchNotes",
    title: "Search notes",
    description: "Full-text search over every note and task in the workspace. Query grammar: plain words match anywhere; \"quoted phrases\" match exactly; filters `path:folder`, `tag:name`, `is:note`, `is:task`, `is:open`, `is:done`, `modified:7d` (also 12h, 2w, today, or a YYYY-MM-DD date). Returns note titles with paths and a preview of the match, and tasks with the note they are in.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query." },
        limit: { type: "number", description: "Most results to return, 1–50. Default 20." },
      },
      required: ["query"],
    },
  },
  {
    name: "noteGraph",
    title: "Note graph",
    description: "Walks the knowledge graph around a note: the notes it links to, the notes that link to it (direction is stated), notes two links away when depth is 2, links to notes that do not exist yet, and notes that share a tag but are not linked (good candidates for new links). Use it to gather related context, find where an idea is discussed, or suggest links. Omit `note` to use the open note, where there is one.",
    inputSchema: {
      type: "object",
      properties: {
        note: NOTE_REFERENCE,
        depth: { type: "number", enum: [1, 2], description: "How many links out to go. Default 1." },
      },
    },
  },
  {
    name: "linkPath",
    title: "Link path",
    description: "Finds the shortest chain of wiki links connecting two notes and states the direction of each step, or says that none exists. Use it to explain how two topics relate in the user's notes.",
    inputSchema: {
      type: "object",
      properties: { from: NOTE_REFERENCE, to: NOTE_REFERENCE },
      required: ["from", "to"],
    },
  },
  {
    name: "listTasks",
    title: "List tasks",
    description: "Lists Markdown checkbox tasks from the user's notes, overdue first, with due date, priority, tags and the note path and line each is written on. Tasks are `- [ ]` lines; metadata is written inline as @due(YYYY-MM-DD[ HH:MM]), @remind(30m), @priority(high|medium|low) and #tags. To change a task, edit that line in the note file.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["open", "done", "all"], description: "Default open." },
        due: { type: "string", enum: ["overdue", "today", "upcoming", "undated", "any"], description: "Default any." },
        tag: { type: "string", description: "Only tasks with this tag." },
        note: NOTE_REFERENCE,
        limit: { type: "number", description: "Most tasks to return, 1–100. Default 50." },
      },
    },
  },
];

export function answerAgentTool(name: AgentToolName, input: unknown, context: AgentToolContext): string {
  const args = typeof input === "object" && input !== null ? input as Record<string, unknown> : {};
  const text = (key: string): string | undefined =>
    typeof args[key] === "string" && (args[key]).trim() !== "" ? args[key] : undefined;
  const number = (key: string): number | undefined =>
    typeof args[key] === "number" && Number.isFinite(args[key]) ? args[key] : undefined;
  const find = (reference: string | undefined): NoteRecord | undefined =>
    reference === undefined ? context.active?.note : resolveNoteReference(context.snapshot, reference);
  const read = (note: NoteRecord): string =>
    describeNote(context.snapshot, note, context.openText?.(note) ?? note.content);
  const missing = (reference: string | undefined): string =>
    reference === undefined ? "No note is open. Name the note to use." : unknownNote(reference);

  switch (name) {
    case "activeNote":
      return context.active === undefined
        ? "No note is open. Ask the user which note they mean, or use the search tool."
        : describeNote(context.snapshot, context.active.note, context.active.content);
    case "readNote": {
      const note = find(text("note"));
      return note === undefined ? missing(text("note")) : read(note);
    }
    case "searchNotes": {
      const query = text("query");
      return query === undefined ? "Give a search query." : describeSearch(context.snapshot, query, number("limit"));
    }
    case "noteGraph": {
      const note = find(text("note"));
      return note === undefined
        ? missing(text("note"))
        : describeNeighbourhood(context.snapshot, note, number("depth") === 2 ? 2 : 1);
    }
    case "linkPath": {
      const from = find(text("from"));
      const to = find(text("to"));
      if (from === undefined) return missing(text("from"));
      if (to === undefined) return missing(text("to"));
      return describeLinkPath(context.snapshot, from, to);
    }
    case "listTasks": {
      const reference = text("note");
      const note = reference === undefined ? undefined : find(reference);
      if (reference !== undefined && note === undefined) return unknownNote(reference);
      const status = oneOf(args.status, ["open", "done", "all"] as const);
      const due = oneOf(args.due, ["overdue", "today", "upcoming", "undated", "any"] as const);
      const tag = text("tag");
      const limit = number("limit");
      const query: TaskQuery = {
        ...(status === undefined ? {} : { status }),
        ...(due === undefined ? {} : { due }),
        ...(tag === undefined ? {} : { tag }),
        ...(note === undefined ? {} : { note }),
        ...(limit === undefined ? {} : { limit }),
      };
      return describeTasks(context.snapshot, query, context.today);
    }
  }
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? value as T : undefined;
}
