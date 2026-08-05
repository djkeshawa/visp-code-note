import type {
  TaskReminderWire,
  TaskWire,
  TasksSnapshotWire,
  TasksToHostWire,
} from "./contracts.js";
import { tagHueColor } from "../application/tagHue.js";
import {
  emptyState,
  htmlElement,
  isRecord,
  requireElement,
  setNotice,
} from "./shared/dom.js";
import { acquireMessageSender } from "./shared/vscodeApi.js";
import {
  dueUrgency,
  formatDueDate,
  groupTasks,
  parseTaskGrouping,
  parseTaskSortKey,
} from "./tasks/grouping.js";
import type { TaskSortDirection, TaskStatusFilter } from "./tasks/grouping.js";

const api = acquireMessageSender<TasksToHostWire>();
const search = requireElement("#task-search", HTMLInputElement);
const groupBy = requireElement("#task-group-by", HTMLSelectElement);
const sortBy = requireElement("#task-sort-by", HTMLSelectElement);
const sortDirection = requireElement("#task-sort-direction", HTMLButtonElement);
const title = requireElement("#task-view-title", HTMLHeadingElement);
const summary = requireElement("#task-summary", HTMLElement);
const groupsRoot = requireElement("#task-groups", HTMLElement);
const countLabel = requireElement("#task-count", HTMLElement);
const errorNotice = requireElement("#tasks-error", HTMLElement);
const statusSegments = Array.from(
  document.querySelectorAll<HTMLButtonElement>("button[data-status]"),
);

let snapshot: TasksSnapshotWire | undefined;
let status: TaskStatusFilter = "open";
let direction: TaskSortDirection = "asc";

search.addEventListener("input", render);
groupBy.addEventListener("change", render);
sortBy.addEventListener("change", render);
sortDirection.addEventListener("click", toggleSortDirection);
for (const segment of statusSegments) {
  segment.addEventListener("click", () => setStatus(parseStatus(segment.dataset.status)));
}
groupsRoot.addEventListener("click", handleTaskClick);
groupsRoot.addEventListener("change", handleTaskToggle);
window.addEventListener("message", handleHostMessage);

// Paint the loading state before the host replies; otherwise the panel opens blank.
setStatus("open");
render();
api.postMessage({ type: "tasks/ready" });

function handleHostMessage(event: MessageEvent<unknown>): void {
  const message = event.data;
  if (!isRecord(message) || typeof message.type !== "string") {
    return;
  }
  if (message.type === "tasks/state" && isTasksSnapshot(message.snapshot)) {
    snapshot = message.snapshot;
    title.textContent = snapshot.filter === "today" ? "Due Today" : "Tasks";
    // Due Today is already a status filter, so the segments would only contradict it.
    const locked = snapshot.filter === "today";
    for (const segment of statusSegments) segment.disabled = locked;
    if (locked) setStatus("open");
    setNotice(errorNotice);
    render();
  } else if (message.type === "tasks/error" && typeof message.message === "string") {
    setNotice(errorNotice, message.message);
    render();
  }
}

function toggleSortDirection(): void {
  direction = direction === "asc" ? "desc" : "asc";
  const ascending = direction === "asc";
  sortDirection.title = ascending
    ? "Ascending — switch to descending"
    : "Descending — switch to ascending";
  sortDirection.setAttribute("aria-pressed", String(!ascending));
  const arrow = sortDirection.querySelector(".codicon");
  arrow?.classList.toggle("codicon-arrow-up", ascending);
  arrow?.classList.toggle("codicon-arrow-down", !ascending);
  render();
}

function setStatus(next: TaskStatusFilter): void {
  status = next;
  for (const segment of statusSegments) {
    const active = segment.dataset.status === next;
    segment.classList.toggle("is-active", active);
    segment.setAttribute("aria-pressed", String(active));
  }
  render();
}

function render(): void {
  groupsRoot.replaceChildren();
  if (snapshot === undefined) {
    summary.textContent = "Waiting for index…";
    groupsRoot.append(emptyState("loading", "Building the workspace task index…"));
    return;
  }
  summary.textContent = summaryText(snapshot);
  const groups = groupTasks(snapshot.tasks, {
    query: search.value,
    status,
    view: snapshot.filter,
    groupBy: parseTaskGrouping(groupBy.value),
    sortBy: parseTaskSortKey(sortBy.value),
    direction,
  });
  if (snapshot.reminders.length > 0) {
    groupsRoot.append(reminderSection(snapshot.reminders));
  }
  // Tag grouping lists a multi-tag task under each of its tags, so count identities.
  const visibleCount = new Set(
    groups.flatMap((group) => group.tasks.map((task) => `${task.noteUri}:${task.range.start}`)),
  ).size;
  countLabel.textContent = `${visibleCount} of ${snapshot.tasks.length} task${
    snapshot.tasks.length === 1 ? "" : "s"
  }`;
  if (groups.length === 0) {
    groupsRoot.append(emptyGroups());
    return;
  }
  for (const group of groups) {
    const section = htmlElement("section", "task-group");
    const heading = htmlElement(
      "h2",
      group.name === "Overdue" ? "task-group-title is-overdue" : "task-group-title",
      group.name,
    );
    heading.append(
      htmlElement("span", "task-group-count", String(group.tasks.length)),
      htmlElement("span", "task-group-rule"),
    );
    section.append(heading, ...group.tasks.map(createTaskRow));
    groupsRoot.append(section);
  }
  /*
   * The design closes the list with a note rather than leaving it to run out. It is only true
   * when nothing is dated beyond the week the list is read against, so it is only shown then.
   */
  if (!groups.some((group) => group.name === "Later")) {
    groupsRoot.append(nothingElseScheduled());
  }
}

/**
 * The reminders the host has armed, pinned above the task groups. They are host state rather
 * than a view of the filtered list, so the search box and status segments leave them alone.
 */
function reminderSection(reminders: readonly TaskReminderWire[]): HTMLElement {
  const section = htmlElement("section", "task-group task-reminders");
  const heading = htmlElement("h2", "task-group-title", "Active reminders");
  heading.append(
    htmlElement("span", "task-group-count", String(reminders.length)),
    htmlElement("span", "task-group-rule"),
  );
  section.append(heading, ...reminders.map(createReminderRow));
  return section;
}

function createReminderRow(reminder: TaskReminderWire): HTMLElement {
  const taskText = reminder.text || "Untitled task";
  const row = htmlElement("div", "reminder-row");
  const bell = htmlElement("span", "codicon codicon-bell reminder-bell");
  bell.setAttribute("aria-hidden", "true");

  const open = htmlElement("button", "task-text", taskText);
  open.type = "button";
  open.title = `${taskText}\nOpen in ${reminder.noteTitle}`;
  open.dataset.action = "open";
  open.dataset.uri = reminder.noteUri;
  open.dataset.start = String(reminder.start);

  const meta = htmlElement("span", "task-meta");
  meta.append(htmlElement("span", "task-meta-note", reminder.noteTitle));
  const when = htmlElement("span", "reminder-when", `rings ${formatReminderMoment(reminder.at)}`);
  when.title = `Due ${reminder.due ?? formatReminderMoment(reminder.dueAt)}`;
  meta.append(when);

  row.append(bell, open, meta);
  return row;
}

/** A reminder is a moment, so the row always says the time as well as the day. */
function formatReminderMoment(at: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(at));
}

function nothingElseScheduled(): HTMLElement {
  const state = emptyState("pass", "Nothing else is scheduled.");
  const hint = htmlElement("p", "empty-state-hint");
  hint.append(
    document.createTextNode("Add "),
    htmlElement("code", "inline-code", "@due(2026-08-14)"),
    document.createTextNode(" to any checkbox to schedule one."),
  );
  state.append(hint);
  return state;
}

function summaryText(current: TasksSnapshotWire): string {
  const open = current.tasks.filter((task) => !task.completed).length;
  const today = localDateKey(new Date());
  const dueToday = current.tasks.filter(
    (task) => !task.completed && task.due?.slice(0, 10) === today,
  ).length;
  return `${open} open · ${dueToday} due today`;
}

function emptyGroups(): HTMLElement {
  if (snapshot?.filter === "today" && search.value.trim() === "") {
    return nothingElseScheduled();
  }
  return emptyState(
    "search",
    "No tasks match the current filters.",
    "Clear the filter text, or switch the status to All.",
  );
}

function createTaskRow(task: TaskWire): HTMLElement {
  const taskText = task.text || "Untitled task";
  /*
   * A div, not a label: a label forwards a click anywhere in the row to the checkbox, so
   * reading a due date completed the task. The checkbox and the text keep their own targets.
   */
  const row = htmlElement("div", task.completed ? "task-row is-completed" : "task-row");

  const priority = htmlElement(
    "span",
    task.priority === undefined ? "task-priority" : `task-priority is-${task.priority}`,
  );
  if (task.priority !== undefined) {
    priority.title = `${task.priority} priority`;
  }

  const checkbox = htmlElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = task.completed;
  checkbox.dataset.action = "toggle";
  checkbox.dataset.uri = task.noteUri;
  checkbox.dataset.start = String(task.range.start);
  checkbox.setAttribute("aria-label", task.completed ? `Reopen ${taskText}` : `Complete ${taskText}`);

  const open = htmlElement("button", "task-text", taskText);
  open.type = "button";
  open.title = `${taskText}\nOpen in ${task.noteTitle}`;
  open.dataset.action = "open";
  open.dataset.uri = task.noteUri;
  open.dataset.start = String(task.range.start);

  row.append(priority, checkbox, open, taskMeta(task));
  return row;
}

/** Tag, source note and due date, in fixed columns so the list scans down as well as across. */
function taskMeta(task: TaskWire): HTMLElement {
  const meta = htmlElement("span", "task-meta");
  const [first] = task.tags;
  if (first !== undefined) {
    const tag = htmlElement("span", "task-meta-tag");
    tag.title = task.tags.map((name) => `#${name}`).join(" ");
    const dot = htmlElement("span", "tag-dot");
    dot.style.setProperty("--tag-hue", tagHueColor(first));
    tag.append(dot, document.createTextNode(`#${first}`));
    meta.append(tag);
  }
  meta.append(htmlElement("span", "task-meta-note", task.noteTitle));
  const urgency = task.completed ? "none" : dueUrgency(task.due);
  const due = htmlElement(
    "span",
    urgency === "overdue"
      ? "task-meta-due is-overdue"
      : urgency === "soon" ? "task-meta-due is-soon" : "task-meta-due",
    formatDueDate(task.due) ?? "—",
  );
  due.title = task.due === undefined ? "No due date" : `Due ${task.due}`;
  meta.append(due);
  return meta;
}

function handleTaskClick(event: MouseEvent): void {
  if (!(event.target instanceof Element)) {
    return;
  }
  const button = event.target.closest<HTMLButtonElement>('button[data-action="open"]');
  const uri = button?.dataset.uri;
  const start = Number(button?.dataset.start);
  if (uri !== undefined && Number.isFinite(start)) {
    api.postMessage({ type: "tasks/open", noteUri: uri, start });
  }
}

function handleTaskToggle(event: Event): void {
  if (!(event.target instanceof HTMLInputElement) || event.target.dataset.action !== "toggle") {
    return;
  }
  const uri = event.target.dataset.uri;
  const start = Number(event.target.dataset.start);
  if (uri !== undefined && Number.isFinite(start)) {
    const currentSnapshot = snapshot;
    const task = currentSnapshot?.tasks.find(
      (candidate) => candidate.noteUri === uri && candidate.range.start === start,
    );
    if (task === undefined || currentSnapshot === undefined) {
      render();
      return;
    }
    event.target.disabled = true;
    api.postMessage({
      type: "tasks/toggle",
      noteUri: uri,
      start,
      ...(task.id === undefined ? {} : { taskId: task.id }),
      completed: task.completed,
      version: currentSnapshot.version,
    });
  }
}

function parseStatus(value: unknown): TaskStatusFilter {
  return value === "all" || value === "completed" ? value : "open";
}

function localDateKey(date: Date): string {
  return [
    String(date.getFullYear()).padStart(4, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function isTasksSnapshot(value: unknown): value is TasksSnapshotWire {
  return (
    isRecord(value) &&
    Array.isArray(value.tasks) &&
    value.tasks.every(isTask) &&
    Array.isArray(value.reminders) &&
    value.reminders.every(isReminder) &&
    isOffset(value.version) &&
    isOffset(value.indexedAt) &&
    (value.filter === "all" || value.filter === "today")
  );
}

function isReminder(value: unknown): value is TaskReminderWire {
  return (
    isRecord(value) &&
    typeof value.noteUri === "string" &&
    typeof value.noteTitle === "string" &&
    isOffset(value.start) &&
    typeof value.text === "string" &&
    (value.due === undefined || typeof value.due === "string") &&
    isOffset(value.at) &&
    isOffset(value.dueAt)
  );
}

function isTask(value: unknown): value is TaskWire {
  return (
    isRecord(value) &&
    (value.id === undefined || typeof value.id === "string") &&
    typeof value.text === "string" &&
    typeof value.completed === "boolean" &&
    (value.due === undefined || typeof value.due === "string") &&
    (value.priority === undefined || isPriority(value.priority)) &&
    typeof value.noteUri === "string" &&
    typeof value.noteTitle === "string" &&
    typeof value.notePath === "string" &&
    (value.noteCreatedAt === undefined || isOffset(value.noteCreatedAt)) &&
    isOffset(value.line) &&
    isOffsetRange(value.range) &&
    isOffsetRange(value.checkboxRange) &&
    value.checkboxRange.start >= value.range.start &&
    value.checkboxRange.end <= value.range.end &&
    Array.isArray(value.tags) &&
    value.tags.every((tag) => typeof tag === "string")
  );
}

function isOffsetRange(value: unknown): value is { readonly start: number; readonly end: number } {
  return isRecord(value) && isOffset(value.start) && isOffset(value.end) && value.start <= value.end;
}

function isOffset(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPriority(value: unknown): value is TaskWire["priority"] {
  return value === "low" || value === "medium" || value === "high";
}
