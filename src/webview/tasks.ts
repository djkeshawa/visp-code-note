import type { TaskWire, TasksSnapshotWire, TasksToHostWire } from "./contracts.js";
import { htmlElement, isRecord, requireElement, setNotice } from "./shared/dom.js";
import { acquireMessageSender } from "./shared/vscodeApi.js";
import { formatDueDate, groupTasks, parseTaskGrouping } from "./tasks/grouping.js";
import type { TaskStatusFilter } from "./tasks/grouping.js";

const api = acquireMessageSender<TasksToHostWire>();
const search = requireElement("#task-search", HTMLInputElement);
const status = requireElement("#task-status", HTMLSelectElement);
const groupBy = requireElement("#task-group-by", HTMLSelectElement);
const title = requireElement("#task-view-title", HTMLHeadingElement);
const groupsRoot = requireElement("#task-groups", HTMLElement);
const countLabel = requireElement("#task-count", HTMLElement);
const errorNotice = requireElement("#tasks-error", HTMLElement);

let snapshot: TasksSnapshotWire | undefined;

search.addEventListener("input", render);
status.addEventListener("change", render);
groupBy.addEventListener("change", render);
groupsRoot.addEventListener("click", handleTaskClick);
groupsRoot.addEventListener("change", handleTaskToggle);
window.addEventListener("message", handleHostMessage);

api.postMessage({ type: "tasks/ready" });

function handleHostMessage(event: MessageEvent<unknown>): void {
  const message = event.data;
  if (!isRecord(message) || typeof message.type !== "string") {
    return;
  }
  if (message.type === "tasks/state" && isTasksSnapshot(message.snapshot)) {
    snapshot = message.snapshot;
    title.textContent = snapshot.filter === "today" ? "Due Today" : "Tasks";
    status.disabled = snapshot.filter === "today";
    if (snapshot.filter === "today") {
      status.value = "open";
    }
    setNotice(errorNotice);
    render();
  } else if (message.type === "tasks/error" && typeof message.message === "string") {
    setNotice(errorNotice, message.message);
    render();
  }
}

function render(): void {
  groupsRoot.replaceChildren();
  if (snapshot === undefined) {
    groupsRoot.append(emptyState("Building the workspace task index…"));
    return;
  }
  const groups = groupTasks(snapshot.tasks, {
    query: search.value,
    status: selectedStatus(),
    view: snapshot.filter,
    groupBy: parseTaskGrouping(groupBy.value),
  });
  // Tag grouping lists a multi-tag task under each of its tags, so count identities.
  const visibleCount = new Set(
    groups.flatMap((group) => group.tasks.map((task) => `${task.noteUri}:${task.range.start}`)),
  ).size;
  countLabel.textContent = `${visibleCount} of ${snapshot.tasks.length} tasks · index ${snapshot.version}`;
  if (groups.length === 0) {
    const message = snapshot.filter === "today" && search.value.trim() === ""
      ? "No incomplete tasks are due today."
      : "No tasks match the current filters.";
    groupsRoot.append(emptyState(message));
    return;
  }
  for (const group of groups) {
    const section = htmlElement("section", "task-group");
    const heading = htmlElement("h2", "task-group-title");
    heading.append(document.createTextNode(group.name), htmlElement("span", "count-badge", String(group.tasks.length)));
    section.append(heading, ...group.tasks.map(createTaskCard));
    groupsRoot.append(section);
  }
}

function createTaskCard(task: TaskWire): HTMLElement {
  const taskText = task.text || "Untitled task";
  const card = htmlElement("article", task.completed ? "task-card is-completed" : "task-card");
  const checkbox = htmlElement("input", "task-card-checkbox");
  checkbox.type = "checkbox";
  checkbox.checked = task.completed;
  checkbox.dataset.action = "toggle";
  checkbox.dataset.uri = task.noteUri;
  checkbox.dataset.start = String(task.range.start);
  checkbox.setAttribute("aria-label", task.completed ? `Reopen ${taskText}` : `Complete ${taskText}`);

  const body = htmlElement("div", "task-card-body");
  const open = htmlElement("button", "task-title-button", taskText);
  open.type = "button";
  open.dataset.action = "open";
  open.dataset.uri = task.noteUri;
  open.dataset.start = String(task.range.start);
  const metadata = htmlElement("div", "task-card-metadata");
  metadata.append(htmlElement("span", "note-reference", task.noteTitle));
  for (const tag of task.tags.slice(0, 3)) {
    metadata.append(htmlElement("span", "task-tag", `#${tag}`));
  }
  body.append(open, metadata);

  const side = htmlElement("div", "task-card-side");
  const due = formatDueDate(task.due);
  if (due !== undefined) {
    side.append(htmlElement("span", "due-date", due));
  }
  if (task.priority !== undefined) {
    side.append(htmlElement("span", `priority-badge priority-${task.priority}`, task.priority));
  }
  card.append(checkbox, body, side);
  return card;
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

function selectedStatus(): TaskStatusFilter {
  return status.value === "all" || status.value === "completed" ? status.value : "open";
}

function emptyState(message: string): HTMLElement {
  return htmlElement("p", "empty-state", message);
}

function isTasksSnapshot(value: unknown): value is TasksSnapshotWire {
  return (
    isRecord(value) &&
    Array.isArray(value.tasks) &&
    value.tasks.every(isTask) &&
    isOffset(value.version) &&
    isOffset(value.indexedAt) &&
    (value.filter === "all" || value.filter === "today")
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
