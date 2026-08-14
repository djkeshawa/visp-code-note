import type { NoteContextWire } from "../contracts.js";
import { htmlElement, requireElement } from "../shared/dom.js";
import { parseMarkdown } from "../../markdown/parser.js";
import type { NoteTask } from "../../domain/models.js";

/**
 * The panel beside the note.
 *
 * Two sources, deliberately: the note's own shape — its outline and its tasks — is read from
 * the draft in the editor, so it tracks what is being typed; what the rest of the workspace
 * says about the note comes from the index, which cannot know about an unsaved keystroke and
 * should not pretend to.
 */
export interface NoteInspectorElements {
  readonly root: HTMLElement;
  readonly outline: HTMLElement;
  readonly backlinks: HTMLElement;
  readonly backlinkCount: HTMLElement;
  readonly tasks: HTMLElement;
  readonly taskCount: HTMLElement;
  readonly links: HTMLElement;
  readonly linkCount: HTMLElement;
}

export interface NoteInspectorActions {
  readonly reveal: (offset: number) => void;
  readonly openBacklink: (uri: string, start: number) => void;
  readonly toggleTask: (task: NoteTask) => void;
  readonly openLink: (target: string) => void;
}

export function getNoteInspectorElements(): NoteInspectorElements {
  return {
    root: requireElement("#note-inspector", HTMLElement),
    outline: requireElement("#inspector-outline", HTMLElement),
    backlinks: requireElement("#inspector-backlinks", HTMLElement),
    backlinkCount: requireElement("#inspector-backlink-count", HTMLElement),
    tasks: requireElement("#inspector-tasks", HTMLElement),
    taskCount: requireElement("#inspector-task-count", HTMLElement),
    links: requireElement("#inspector-links", HTMLElement),
    linkCount: requireElement("#inspector-link-count", HTMLElement),
  };
}

/**
 * Which halves of the inspector to redraw.
 *
 * The outline and the task list are the draft's own shape and follow every keystroke. Backlinks
 * and links-out come from the index and cannot move while you type, so rebuilding their DOM —
 * up to a hundred rows and their listeners — on every character was pure waste.
 */
export type NoteInspectorSections = "all" | "draft";

export function renderNoteInspector(
  elements: NoteInspectorElements,
  source: string,
  context: NoteContextWire | undefined,
  actions: NoteInspectorActions,
  sections: NoteInspectorSections = "all",
): void {
  const parsed = parseMarkdown(source);
  renderOutline(elements, parsed.headings, parsed.blockReferences, actions);
  renderTasks(elements, parsed.tasks, actions);
  if (sections === "all") {
    renderBacklinks(elements, context, actions);
    renderLinks(elements, context, actions);
  }
}

function renderOutline(
  elements: NoteInspectorElements,
  headings: ReturnType<typeof parseMarkdown>["headings"],
  blockReferences: ReturnType<typeof parseMarkdown>["blockReferences"],
  actions: NoteInspectorActions,
): void {
  /*
   * Headings and block anchors are both places in the note something can link to, so they
   * share one list in document order rather than sitting in two — the note has one shape.
   */
  const entries = [
    ...headings.map((heading) => ({
      offset: heading.range.start,
      label: heading.text,
      level: heading.level,
      anchor: false,
    })),
    ...blockReferences.map((reference) => ({
      offset: reference.range.start,
      label: `^${reference.id}`,
      level: 2,
      anchor: true,
    })),
  ].sort((left, right) => left.offset - right.offset);

  if (entries.length === 0) {
    elements.outline.replaceChildren(
      htmlElement("p", "inspector-empty", "This note has no headings yet."),
    );
    return;
  }

  elements.outline.replaceChildren(...entries.map((entry) => {
    const classes = ["inspector-outline-row"];
    if (entry.level <= 1 && !entry.anchor) classes.push("is-top");
    if (entry.anchor) classes.push("is-anchor");
    const row = htmlElement("button", classes.join(" "));
    row.type = "button";
    // Where the entry begins, so the caret can be matched against the list without reparsing.
    row.dataset.offset = String(entry.offset);
    // One step per level, then flat: past the third the label matters more than the depth.
    row.style.paddingLeft = `${14 + Math.min(entry.level - 1, 3) * 12}px`;
    row.title = entry.anchor
      ? `Block anchor ${entry.label}`
      : `Heading level ${entry.level}: ${entry.label}`;
    row.append(htmlElement("span", "inspector-outline-label", entry.label));
    row.addEventListener("click", () => actions.reveal(entry.offset));
    return row;
  }));
}

/**
 * Marks the section the caret is in: the last entry at or before it.
 *
 * Without this the outline is a list of places to go and says nothing about where the reader
 * already is — in a fifty-heading note, fifty identical buttons. The entries are in document
 * order in the DOM, so the row itself carries the offset and nothing has to be parsed again.
 *
 * The scroll only happens when the current entry changes, so a long outline follows the caret
 * without the panel moving under a reader who is scrolling it themselves.
 */
export function markCurrentOutlineEntry(
  elements: NoteInspectorElements,
  caret: number,
): void {
  /*
   * A query rather than `children`, which is a live collection: indexing one is a walk of the
   * parent per element, so reading fifty rows that way cost more than the whole rest of this.
   */
  const rows = Array.from(elements.outline.querySelectorAll<HTMLElement>(".inspector-outline-row"));
  let current: HTMLElement | undefined;
  for (const row of rows) {
    const offset = Number(row.dataset.offset);
    if (!Number.isFinite(offset) || offset > caret) break;
    current = row;
  }
  if (current !== undefined && current.classList.contains("is-current")) return;
  for (const marked of Array.from(elements.outline.querySelectorAll<HTMLElement>(".is-current"))) {
    marked.classList.remove("is-current");
  }
  if (current === undefined) return;
  current.classList.add("is-current");
  // jsdom has no layout and so no `scrollIntoView`; the panel is drawn by a browser that has.
  current.scrollIntoView?.({ block: "nearest" });
}

function renderBacklinks(
  elements: NoteInspectorElements,
  context: NoteContextWire | undefined,
  actions: NoteInspectorActions,
): void {
  const backlinks = context?.backlinks ?? [];
  elements.backlinkCount.textContent = String(context?.backlinkCount ?? 0);
  if (backlinks.length === 0) {
    elements.backlinks.replaceChildren(
      htmlElement("p", "inspector-empty", "No notes link here yet."),
    );
    return;
  }
  elements.backlinks.replaceChildren(...backlinks.map((backlink) => {
    const row = htmlElement("button", "inspector-backlink");
    row.type = "button";
    row.setAttribute(
      "aria-label",
      `Open the mention in ${backlink.title}, line ${backlink.line + 1}`,
    );
    const header = htmlElement("span", "inspector-backlink-header");
    header.append(
      htmlElement("span", "inspector-backlink-dot"),
      htmlElement("span", "inspector-backlink-title", backlink.title),
      htmlElement("span", "inspector-backlink-line", `L${backlink.line + 1}`),
    );
    row.append(
      header,
      htmlElement("span", "inspector-backlink-context", backlink.context),
    );
    row.addEventListener("click", () => actions.openBacklink(backlink.uri, backlink.start));
    return row;
  }));
}

function renderTasks(
  elements: NoteInspectorElements,
  tasks: readonly NoteTask[],
  actions: NoteInspectorActions,
): void {
  elements.taskCount.textContent = String(tasks.length);
  if (tasks.length === 0) {
    elements.tasks.replaceChildren(
      htmlElement("p", "inspector-empty", "No tasks in this note."),
    );
    return;
  }
  elements.tasks.replaceChildren(...tasks.map((task) => {
    const text = task.text.length > 0 ? task.text : "Untitled task";
    const row = htmlElement(
      "label",
      task.completed ? "inspector-task is-completed" : "inspector-task",
    );
    const checkbox = htmlElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = task.completed;
    checkbox.setAttribute("aria-label", task.completed ? `Reopen ${text}` : `Complete ${text}`);
    checkbox.addEventListener("change", () => actions.toggleTask(task));
    // The label and the metadata are siblings, not nested: `line-through` is drawn by the
    // element that declares it, so a struck-out wrapper strikes its due date too.
    const body = htmlElement("span", "inspector-task-body");
    body.append(htmlElement("span", "inspector-task-text", text), taskMeta(task));
    row.append(checkbox, body);
    return row;
  }));
}

/** "Due Aug 3 · high", or what stands in for it when a task carries neither. */
function taskMeta(task: NoteTask): HTMLElement {
  const due = formatDue(task.due);
  const parts = [due ?? "No due date", ...(task.priority === undefined ? [] : [task.priority])];
  return htmlElement(
    "span",
    due === undefined ? "inspector-task-meta" : "inspector-task-meta is-due",
    parts.join(" · "),
  );
}

function formatDue(due: string | undefined): string | undefined {
  if (due === undefined) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(due);
  if (match === null) return `Due ${due}`;
  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return `Due ${new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date)}`;
}

function renderLinks(
  elements: NoteInspectorElements,
  context: NoteContextWire | undefined,
  actions: NoteInspectorActions,
): void {
  const links = context?.linksOut ?? [];
  elements.linkCount.textContent = String(context?.outgoingCount ?? 0);
  if (links.length === 0) {
    elements.links.replaceChildren(
      htmlElement("p", "inspector-empty", "This note links nowhere yet."),
    );
    return;
  }
  elements.links.replaceChildren(...links.map((link) => {
    const chip = htmlElement(
      "button",
      link.resolved ? "inspector-link" : "inspector-link is-unresolved",
    );
    chip.type = "button";
    chip.textContent = link.resolved ? link.label : `${link.label} · unresolved`;
    chip.title = link.resolved
      ? `Open ${link.target}`
      : `${link.target} has not been written yet — opening it offers to create it`;
    chip.addEventListener("click", () => actions.openLink(link.target));
    return chip;
  }));
}
