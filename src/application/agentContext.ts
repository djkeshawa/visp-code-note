import type { IndexSnapshot, NoteRecord } from "../domain/models";
import { noteResolverFor } from "../indexing/noteResolver";
import { matchesAnyGlob } from "../indexing/glob";
import { buildNoteContext } from "../indexing/projections";
import { bucketFor } from "./dueTasks";
import type { DueBucket } from "./dueTasks";
import { buildWorkspaceSearchPage } from "./workspaceSearch";

/**
 * What a language-model agent is told about the notes.
 *
 * Copilot and other agents read files; they do not see the index, so they cannot tell which
 * note links to which, what mentions a note, or which tasks are late without reading the whole
 * vault. These functions answer those questions from the index Visp Notes already keeps and
 * render the answer as compact Markdown, the form a model reads most reliably. Every note is
 * named by its workspace path, which is what the agent's own file tools take, so an answer
 * leads straight to an edit.
 *
 * Nothing here touches VS Code, so every answer is unit-tested against a built snapshot.
 */

/** Past this a note's body is cut, so one enormous note cannot fill a model's context. */
export const NOTE_CONTENT_LIMIT = 24_000;
const BACKLINK_LIMIT = 25;
const TASK_LIMIT = 100;

/**
 * The snapshot as agents may see it: without the notes matched by `vispNotes.agents.exclude`.
 *
 * A withheld note is gone from everything an agent can ask — it cannot be read, searched,
 * listed as a task, walked to in the graph, or passed through on a link path — and the
 * mentions it makes of other notes go with it. A visible note that links to it still shows the
 * link, since the link is in the visible note's own text, but says the target is withheld
 * rather than missing, so an agent does not helpfully create a duplicate.
 */
const views = new WeakMap<IndexSnapshot, { readonly key: string; readonly view: IndexSnapshot }>();

export function agentView(snapshot: IndexSnapshot, exclude: readonly string[]): IndexSnapshot {
  if (exclude.length === 0) return snapshot;
  const key = exclude.join("\n");
  const cached = views.get(snapshot);
  if (cached?.key === key) return cached.view;
  const visible = new Set(snapshot.notes.filter((note) => !matchesAnyGlob(note.path, exclude)).map((note) => note.uri));
  const view: IndexSnapshot = {
    ...snapshot,
    notes: snapshot.notes.filter((note) => visible.has(note.uri)),
    links: snapshot.links.filter((link) => visible.has(link.sourceUri)),
    backlinks: snapshot.backlinks.filter((backlink) => visible.has(backlink.sourceUri) && visible.has(backlink.targetUri)),
    tasks: snapshot.tasks.filter((task) => visible.has(task.noteUri)),
  };
  views.set(snapshot, { key, view });
  return view;
}

export function isWithheld(note: { readonly path: string }, exclude: readonly string[]): boolean {
  return exclude.length > 0 && matchesAnyGlob(note.path, exclude);
}

export function resolveNoteReference(snapshot: IndexSnapshot, reference: string): NoteRecord | undefined {
  const trimmed = reference.trim().replace(/^\[\[|\]\]$/g, "");
  if (trimmed === "") return undefined;
  return snapshot.notes.find((note) => note.uri === trimmed)
    ?? noteResolverFor(snapshot.notes).resolve("", trimmed);
}

export function unknownNote(reference: string): string {
  return `No note matches "${reference}". Use the search tool to find its title or path.`;
}

/**
 * One note, as the inspector sees it: where it is, what it is tagged, what links to it and what
 * it links to, its tasks, then the text itself. `content` overrides the indexed text, so an
 * open note with unsaved edits is described as the reader currently sees it.
 */
export function describeNote(snapshot: IndexSnapshot, note: NoteRecord, content = note.content): string {
  const context = buildNoteContext(snapshot, note.uri);
  const lines = [`# ${note.title}`, "", `- Path: \`${note.path}\``];
  if (note.aliases.length > 0) lines.push(`- Aliases: ${note.aliases.join(", ")}`);
  if (note.tags.length > 0) lines.push(`- Tags: ${note.tags.map((tag) => `#${tag}`).join(" ")}`);
  lines.push(`- Last modified: ${new Date(note.modifiedAt).toISOString()}`);

  const outline = note.headings.map((heading) => `${"  ".repeat(Math.max(0, heading.level - 1))}- ${heading.text}`);
  if (outline.length > 0) lines.push("", "## Outline", ...outline);

  const out = context?.linksOut ?? [];
  if (out.length > 0) {
    lines.push("", `## Links out (${out.length})`);
    for (const link of out) {
      const target = link.resolved ? resolveNoteReference(snapshot, link.target) : undefined;
      lines.push(target !== undefined
        ? `- [[${link.target}]] → \`${target.path}\``
        : link.resolved
          ? `- [[${link.target}]] — exists, but is not shared with agents`
          : `- [[${link.target}]] — no such note yet`);
    }
  }

  const backlinks = snapshot.backlinks.filter((backlink) => backlink.targetUri === note.uri);
  if (backlinks.length > 0) {
    lines.push("", `## Linked from (${backlinks.length})`);
    for (const backlink of backlinks.slice(0, BACKLINK_LIMIT)) {
      lines.push(`- \`${backlink.sourcePath}\` line ${backlink.line + 1}: ${oneLine(backlink.context)}`);
    }
    if (backlinks.length > BACKLINK_LIMIT) lines.push(`- …and ${backlinks.length - BACKLINK_LIMIT} more`);
  }

  if (note.tasks.length > 0) {
    lines.push("", `## Tasks (${note.tasks.filter((task) => !task.completed).length} open)`);
    for (const task of note.tasks) lines.push(`- ${taskLine(task)}`);
  }

  const cut = content.length > NOTE_CONTENT_LIMIT;
  const body = cut ? content.slice(0, NOTE_CONTENT_LIMIT) : content;
  // A fence longer than any run of backticks in the note, so the note cannot close it early.
  const fence = "`".repeat(Math.max(4, ...Array.from(body.matchAll(/`+/g), (run) => run[0].length + 1)));
  lines.push("", "## Content", "", `${fence}markdown`, body, fence);
  if (cut) lines.push(`(Cut at ${NOTE_CONTENT_LIMIT} of ${content.length} characters. Read the file for the rest.)`);
  return lines.join("\n");
}

/** The workspace search, with the same query grammar as the Search Notes and Tasks command. */
export function describeSearch(snapshot: IndexSnapshot, query: string, limit = 20): string {
  const page = buildWorkspaceSearchPage(snapshot, query, Math.min(Math.max(1, limit), 50));
  if (page.results.length === 0) return `No notes or tasks match \`${query}\`.`;
  const lines = [`${page.matched} match${page.matched === 1 ? "" : "es"} for \`${query}\`${page.matched > page.results.length ? `, first ${page.results.length} shown` : ""}:`, ""];
  for (const result of page.results) {
    const where = `\`${result.notePath}\``;
    lines.push(result.kind === "task"
      ? `- Task [${result.completed === true ? "x" : " "}] ${oneLine(result.displayText)} — in ${where}`
      : `- **${result.noteTitle}** ${where} (${result.matchedField}): ${oneLine(result.preview)}`);
  }
  return lines.join("\n");
}

/**
 * The graph around a note, hop by hop. Direction is kept — "links to" and "linked from" are
 * different facts, and an agent tracing an argument needs to know which note cites which —
 * and notes that share a tag without linking are listed separately, since that is where the
 * graph suggests a link nobody has written yet.
 */
export function describeNeighbourhood(snapshot: IndexSnapshot, note: NoteRecord, depth: 1 | 2 = 1): string {
  const outgoing = linkMap(snapshot, "out");
  const incoming = linkMap(snapshot, "in");
  const byUri = new Map(snapshot.notes.map((entry) => [entry.uri, entry]));
  const lines = [`# Around ${note.title} (\`${note.path}\`)`];
  const seen = new Set([note.uri]);
  let frontier = [note.uri];
  for (let hop = 1; hop <= depth; hop += 1) {
    const next: string[] = [];
    const rows: string[] = [];
    for (const from of frontier) {
      const neighbours = new Set([...(outgoing.get(from) ?? []), ...(incoming.get(from) ?? [])]);
      for (const uri of neighbours) {
        if (seen.has(uri)) continue;
        seen.add(uri);
        next.push(uri);
        const other = byUri.get(uri);
        if (other === undefined) continue;
        const to = outgoing.get(from)?.has(uri) === true;
        const back = incoming.get(from)?.has(uri) === true;
        const relation = to && back ? "links both ways with" : to ? "links to" : "is linked from";
        const via = hop === 1 ? "" : ` (via ${byUri.get(from)?.title ?? from})`;
        rows.push(`- ${hop === 1 ? note.title : byUri.get(from)?.title} ${relation} **${other.title}** \`${other.path}\`${via}`);
      }
    }
    lines.push("", `## ${hop === 1 ? "Direct links" : "Two links away"} (${rows.length})`, ...(rows.length > 0 ? rows : ["- none"]));
    frontier = next;
  }

  const unresolved = snapshot.links
    .filter((link) => link.sourceUri === note.uri && link.targetUri === undefined)
    .map((link) => link.link.target);
  if (unresolved.length > 0) {
    lines.push("", "## Links to notes that do not exist yet", ...[...new Set(unresolved)].map((target) => `- [[${target}]]`));
  }

  const related = sharedTagNotes(snapshot, note, seen);
  if (related.length > 0) {
    lines.push("", "## Share a tag but are not linked", ...related.map(({ other, tags }) =>
      `- **${other.title}** \`${other.path}\` — ${tags.map((tag) => `#${tag}`).join(" ")}`));
  }
  return lines.join("\n");
}

/** The shortest chain of links between two notes, ignoring direction, with each step's direction said. */
export function describeLinkPath(snapshot: IndexSnapshot, from: NoteRecord, to: NoteRecord): string {
  if (from.uri === to.uri) return `${from.title} and ${to.title} are the same note.`;
  const outgoing = linkMap(snapshot, "out");
  const incoming = linkMap(snapshot, "in");
  const previous = new Map<string, string>([[from.uri, ""]]);
  let frontier = [from.uri];
  while (frontier.length > 0 && !previous.has(to.uri)) {
    const next: string[] = [];
    for (const uri of frontier) {
      for (const neighbour of [...(outgoing.get(uri) ?? []), ...(incoming.get(uri) ?? [])]) {
        if (previous.has(neighbour)) continue;
        previous.set(neighbour, uri);
        next.push(neighbour);
      }
    }
    frontier = next;
  }
  if (!previous.has(to.uri)) return `No chain of links connects ${from.title} and ${to.title}.`;
  const path = [to.uri];
  while (path[0] !== from.uri) path.unshift(previous.get(path[0] ?? "") ?? from.uri);
  const byUri = new Map(snapshot.notes.map((note) => [note.uri, note]));
  const lines = [`${from.title} → ${to.title}: ${path.length - 1} link${path.length === 2 ? "" : "s"} apart.`, ""];
  for (let index = 0; index + 1 < path.length; index += 1) {
    const left = byUri.get(path[index] ?? "");
    const right = byUri.get(path[index + 1] ?? "");
    if (left === undefined || right === undefined) continue;
    const forward = outgoing.get(left.uri)?.has(right.uri) === true;
    lines.push(`${index + 1}. **${left.title}** ${forward ? "links to" : "is linked from"} **${right.title}** \`${right.path}\``);
  }
  return lines.join("\n");
}

export interface TaskQuery {
  readonly status?: "open" | "done" | "all";
  readonly due?: "overdue" | "today" | "upcoming" | "undated" | "any";
  readonly tag?: string;
  readonly note?: NoteRecord;
  readonly limit?: number;
}

export function describeTasks(snapshot: IndexSnapshot, query: TaskQuery, today: string): string {
  const status = query.status ?? "open";
  const tag = query.tag?.replace(/^#/, "").toLowerCase();
  const matched = snapshot.tasks.filter((task) =>
    (status === "all" || task.completed === (status === "done")) &&
    (query.due === undefined || query.due === "any" || bucketFor(task.due, today) === query.due) &&
    (tag === undefined || tag === "" || task.tags.some((entry) => entry.toLowerCase() === tag)) &&
    (query.note === undefined || task.noteUri === query.note.uri));
  if (matched.length === 0) return "No tasks match.";
  const order: Record<DueBucket, number> = { overdue: 0, today: 1, upcoming: 2, undated: 3 };
  const sorted = [...matched].sort((left, right) =>
    order[bucketFor(left.due, today)] - order[bucketFor(right.due, today)] ||
    (left.due ?? "").localeCompare(right.due ?? ""));
  const limit = Math.min(Math.max(1, query.limit ?? 50), TASK_LIMIT);
  const lines = [`${matched.length} task${matched.length === 1 ? "" : "s"} (today is ${today}):`, ""];
  for (const task of sorted.slice(0, limit)) {
    const bucket = bucketFor(task.due, today);
    const flag = task.completed || bucket === "undated" || bucket === "upcoming" ? "" : ` **${bucket}**`;
    lines.push(`- ${taskLine(task)}${flag} — \`${task.notePath}\` line ${task.line + 1}`);
  }
  if (matched.length > limit) lines.push(`- …and ${matched.length - limit} more`);
  return lines.join("\n");
}

function taskLine(task: IndexSnapshot["tasks"][number] | NoteRecord["tasks"][number]): string {
  const meta = [
    task.due === undefined ? undefined : `due ${task.due}`,
    task.priority === undefined ? undefined : `${task.priority} priority`,
    ...task.tags.map((tag) => `#${tag}`),
  ].filter((part) => part !== undefined);
  return `[${task.completed ? "x" : " "}] ${oneLine(task.text)}${meta.length > 0 ? ` (${meta.join(", ")})` : ""}`;
}

function linkMap(snapshot: IndexSnapshot, direction: "out" | "in"): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  const known = new Set(snapshot.notes.map((note) => note.uri));
  for (const link of snapshot.links) {
    if (link.targetUri === undefined || link.targetUri === link.sourceUri) continue;
    // A link into a note the snapshot does not hold — one withheld from agents — is not walked.
    if (!known.has(link.targetUri) || !known.has(link.sourceUri)) continue;
    const [key, value] = direction === "out" ? [link.sourceUri, link.targetUri] : [link.targetUri, link.sourceUri];
    let set = map.get(key);
    if (set === undefined) map.set(key, set = new Set());
    set.add(value);
  }
  return map;
}

function sharedTagNotes(
  snapshot: IndexSnapshot,
  note: NoteRecord,
  linked: ReadonlySet<string>,
): { readonly other: NoteRecord; readonly tags: readonly string[] }[] {
  const tags = new Set(note.tags.map((tag) => tag.toLowerCase()));
  if (tags.size === 0) return [];
  return snapshot.notes
    .filter((other) => !linked.has(other.uri))
    .map((other) => ({ other, tags: other.tags.filter((tag) => tags.has(tag.toLowerCase())) }))
    .filter((entry) => entry.tags.length > 0)
    .sort((left, right) => right.tags.length - left.tags.length || left.other.title.localeCompare(right.other.title))
    .slice(0, 15);
}

function oneLine(value: string): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > 200 ? `${flat.slice(0, 199)}…` : flat;
}
