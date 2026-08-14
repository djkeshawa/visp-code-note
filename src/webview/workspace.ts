import type {
  WorkspaceFolderRowWire,
  WorkspaceNoteRowWire,
  WorkspacePanelStateWire,
  WorkspaceTaskRowWire,
  WorkspaceToHostWire,
  WorkspaceViewRowWire,
} from "./contracts.js";
import { tagHueColor } from "../application/tagHue.js";
import { dueUrgency } from "./tasks/grouping.js";
import { formatIndexedAt } from "../application/indexFreshness.js";
import { oversizedReason, oversizedTally } from "../application/oversizedNotes.js";
import {
  codicon,
  emptyState,
  htmlElement,
  isRecord,
  requireElement,
  setNotice,
} from "./shared/dom.js";
import { acquireWebviewApi } from "./shared/vscodeApi.js";
import { RovingList, isBareKey } from "./shared/rovingList.js";
import { workspaceEmptyState } from "./workspace/emptyState.js";
import { workspaceTreeRows } from "../application/workspaceFolderTree.js";
import { noteRowQualifiers } from "../application/noteRowQualifier.js";

/**
 * The workspace panel.
 *
 * It holds one piece of state of its own — which sections and folders are open — and gets
 * everything else from the index. Expansion is remembered across a reload through the
 * webview's own state, because a panel that forgets which folder you opened every time the
 * side bar is hidden is worse than no folders at all.
 */
interface PanelState {
  readonly expanded: readonly string[];
}

const api = acquireWebviewApi<WorkspaceToHostWire, PanelState>();
const shell = requireElement(".workspace-shell", HTMLElement);
const filter = requireElement("#workspace-filter", HTMLInputElement);
const filterStatus = requireElement("#workspace-filter-status", HTMLElement);
const searchButton = requireElement("#workspace-search", HTMLButtonElement);
const viewsRoot = requireElement("#workspace-views", HTMLElement);
const notesRoot = requireElement("#workspace-notes", HTMLElement);
const noteCount = requireElement("#workspace-note-count", HTMLElement);
const tagsRoot = requireElement("#workspace-tags", HTMLElement);
const statusRow = requireElement("#workspace-status", HTMLElement);
const statusDot = requireElement("#workspace-status-dot", HTMLElement);
const statusText = requireElement("#workspace-status-text", HTMLElement);
const statusIndexed = requireElement("#workspace-status-indexed", HTMLElement);
const errorNotice = requireElement("#workspace-error", HTMLElement);
const noteMenu = requireElement("#workspace-menu", HTMLElement);
const noteMenuTitle = requireElement("#workspace-menu-note", HTMLElement);
const noteMenuItems = Array.from(
  noteMenu.querySelectorAll<HTMLButtonElement>(".workspace-menu-item"),
);

const DUE_TODAY_KEY = "view:due";
const FILTER_DEBOUNCE_MS = 120;

/**
 * How many note rows the panel draws at once.
 *
 * A side bar shows about 30 rows; drawing 570 costs thousands of elements nobody scrolls to.
 * The rest are reachable by narrowing the filter, and the row that replaces them says so.
 */
const VISIBLE_NOTE_LIMIT = 200;

let state: WorkspacePanelStateWire | undefined;
let activeNoteUri: string | undefined;
/** The note the open menu belongs to, and the row it was raised from. */
let menuNote: { readonly uri: string; readonly row: HTMLElement } | undefined;
const expanded = new Set(api.getState()?.expanded ?? [DUE_TODAY_KEY]);

/*
 * Typing runs the whole panel through render(). At 570 notes that is a few thousand elements
 * per character, so the field waits for a pause rather than redrawing on every keystroke.
 */
let filterTimer: number | undefined;
/**
 * Which notes the host says match the current query by content. The panel can only filter
 * what it holds — titles and paths — but a query is usually about what a note *says*, so
 * each settled query is also sent to the host, and its answer widens the filter. The query
 * rides along so an answer that arrives after further typing is recognised as stale.
 */
let contentMatches: { readonly query: string; readonly uris: ReadonlySet<string> } | undefined;
/**
 * How long a settled query waits for the host's content answer before painting without it.
 * Painting immediately and again when the answer landed drew the list twice per keystroke —
 * rows appeared, then jumped as content matches widened the set. The answer normally arrives
 * well inside this window, so the list paints once; a host that is busy building its index
 * still gets title and path matches on screen at the deadline.
 */
const CONTENT_ANSWER_GRACE_MS = 250;
let answerTimer: number | undefined;
filter.addEventListener("input", () => {
  if (filterTimer !== undefined) window.clearTimeout(filterTimer);
  filterTimer = window.setTimeout(() => {
    filterTimer = undefined;
    requestContentMatches();
    const query = filter.value.trim();
    if (query.length === 0 || contentMatches?.query === query) {
      render();
    } else {
      scheduleAnswerFallback();
    }
  }, FILTER_DEBOUNCE_MS);
});
/**
 * The two lists the panel can be steered around. Each is one tab stop rather than one per row:
 * a filtered list of 60 notes used to be 60 Tab presses deep, through a list that redraws
 * under the reader between presses.
 */
const viewsNavigation = new RovingList(viewsRoot, {
  rows: ".workspace-row, .workspace-task",
  controls: "button, input",
});
const notesNavigation = new RovingList(notesRoot, { rows: ".workspace-row" });

filter.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && filter.value.length > 0) {
    event.preventDefault();
    filter.value = "";
    if (filterTimer !== undefined) window.clearTimeout(filterTimer);
    filterTimer = undefined;
    clearAnswerFallback();
    contentMatches = undefined;
    render();
    return;
  }
  /*
   * Typing narrowed 60 rows to 3 and then there was nothing to do with them without a mouse:
   * Enter did nothing and ArrowDown did nothing. Enter opens the top row, ArrowDown steps into
   * the list — the two things a reader who has just finished typing reaches for.
   *
   * Both aim at the same row, the topmost one on screen, which is why they run through the
   * same list of candidates in the order the panel draws them.
   */
  if (!isBareKey(event)) return;
  if (event.key === "Enter") {
    const row = firstListRow();
    if (row === undefined) return;
    event.preventDefault();
    /*
     * Flushed first: the field is debounced, so Enter typed straight after the last character
     * would otherwise open whichever row the *previous* query had left at the top.
     */
    settleFilter();
    firstListRow()?.click();
  } else if (event.key === "ArrowDown") {
    event.preventDefault();
    settleFilter();
    if (!viewsNavigation.focusFirst()) notesNavigation.focusFirst();
  }
});

/** The row Enter and ArrowDown aim at: the first one drawn, views before notes. */
function firstListRow(): HTMLElement | undefined {
  return viewsNavigation.firstRow() ?? notesNavigation.firstRow();
}

/** Paints whatever the field currently says, without waiting out the typing pause. */
function settleFilter(): void {
  if (filterTimer === undefined) return;
  window.clearTimeout(filterTimer);
  filterTimer = undefined;
  requestContentMatches();
  render();
}

function scheduleAnswerFallback(): void {
  clearAnswerFallback();
  answerTimer = window.setTimeout(() => {
    answerTimer = undefined;
    render();
  }, CONTENT_ANSWER_GRACE_MS);
}

function clearAnswerFallback(): void {
  if (answerTimer !== undefined) {
    window.clearTimeout(answerTimer);
    answerTimer = undefined;
  }
}

function requestContentMatches(): void {
  const query = filter.value.trim();
  if (query.length === 0) {
    contentMatches = undefined;
    return;
  }
  api.postMessage({ type: "workspace/filter", query });
}
searchButton.addEventListener("click", () =>
  api.postMessage({ type: "workspace/runCommand", command: "search" }));
window.addEventListener("message", handleHostMessage);

render();
api.postMessage({ type: "workspace/ready" });

function handleHostMessage(event: MessageEvent<unknown>): void {
  const message = event.data;
  if (!isRecord(message) || typeof message.type !== "string") return;
  if (message.type === "workspace/state" && isPanelState(message.state)) {
    state = message.state;
    setNotice(errorNotice);
    // The index moved, so which notes match the query by content may have moved with it.
    requestContentMatches();
    render();
  } else if (
    message.type === "workspace/filterMatches" &&
    typeof message.query === "string" &&
    Array.isArray(message.uris) &&
    message.uris.every((uri: unknown) => typeof uri === "string")
  ) {
    if (message.query === filter.value.trim()) {
      contentMatches = { query: message.query, uris: new Set(message.uris) };
      // The paint this answer belongs to is waiting on it; this render is that paint.
      clearAnswerFallback();
      render();
    }
  } else if (
    message.type === "workspace/activeNote" &&
    (message.uri === undefined || typeof message.uri === "string")
  ) {
    // One field moved, so one class moves with it rather than the whole panel redrawing.
    activeNoteUri = message.uri;
    markActiveNote();
  } else if (message.type === "workspace/error" && typeof message.message === "string") {
    setNotice(errorNotice, message.message);
  }
}

function toggleExpanded(key: string): void {
  if (expanded.has(key)) expanded.delete(key);
  else expanded.add(key);
  api.setState({ expanded: [...expanded] });
  pendingRowFocus = key;
  render();
}

/** Matches a row against the filter. Empty query matches everything. */
function matches(haystack: string): boolean {
  const query = filter.value.trim().toLocaleLowerCase();
  return query.length === 0 || haystack.toLocaleLowerCase().includes(query);
}

/*
 * The task a toggle came from. The host republishes after a toggle and `render` replaces every
 * row, destroying the checkbox the reader was standing on — so focus falls to the body unless
 * it is deliberately put back.
 */
let pendingTaskFocus: { readonly uri: string; readonly start: number } | undefined;

/**
 * The expansion key of the row that was just opened or closed, for the same reason: expanding
 * from the keyboard replaces the row the reader was standing on, and focus falls to the body.
 */
let pendingRowFocus: string | undefined;

function render(): void {
  // Every row about to be replaced, including the one the menu names.
  closeNoteMenu(false);
  if (state === undefined) {
    viewsRoot.replaceChildren();
    notesRoot.replaceChildren(htmlElement("p", "workspace-empty", "Building the index…"));
    tagsRoot.replaceChildren();
    return;
  }
  shell.dataset.density = state.density;
  activeNoteUri = state.activeNoteUri;
  renderViews(state);
  renderNotes(state);
  renderTags(state);
  renderStatus(state);
  restoreTaskFocus();
  restoreRowFocus();
}

/**
 * Puts focus back on the task that was toggled, or on the row that replaced it.
 *
 * Due Today lists only what is still open, so completing a task removes its row — landing on
 * whatever moved up into that place is what a reader working down the list expects, and is in
 * any case better than the body.
 */
function restoreTaskFocus(): void {
  const target = pendingTaskFocus;
  if (target === undefined) return;
  pendingTaskFocus = undefined;

  const checkboxes = Array.from(
    viewsRoot.querySelectorAll<HTMLInputElement>("input[data-task-uri]"),
  );
  const exact = checkboxes.find(
    (box) => box.dataset.taskUri === target.uri && box.dataset.taskStart === String(target.start),
  );
  if (exact !== undefined) {
    exact.focus();
    return;
  }
  if (checkboxes[0] !== undefined) checkboxes[0].focus();
  else viewsRoot.querySelector<HTMLButtonElement>(".workspace-row")?.focus();
}

/** Puts focus back on the row that was expanded or collapsed, once its replacement exists. */
function restoreRowFocus(): void {
  const key = pendingRowFocus;
  if (key === undefined) return;
  pendingRowFocus = undefined;

  const rows = Array.from(
    shell.querySelectorAll<HTMLButtonElement>(".workspace-row[data-expand-key]"),
  );
  rows.find((row) => row.dataset.expandKey === key)?.focus();
}

/** Moves the current-note highlight without rebuilding a row. */
function markActiveNote(): void {
  const rows = Array.from(
    notesRoot.querySelectorAll<HTMLElement>(".workspace-row[data-uri]"),
  );
  for (const row of rows) {
    row.classList.toggle("is-active", row.dataset.uri === activeNoteUri);
  }
}

function renderViews(current: WorkspacePanelStateWire): void {
  const rows: HTMLElement[] = [];
  for (const view of current.views) {
    if (!matches(view.label)) continue;
    rows.push(viewRow(view, current));
    if (view.id === "due" && expanded.has(DUE_TODAY_KEY)) {
      const tasks = current.dueToday.filter((task) => matches(task.text));
      rows.push(...(tasks.length === 0
        ? [htmlElement("p", "workspace-empty", "Nothing due today or overdue.")]
        : tasks.map((task) => taskRow(task, current.version))));
    }
  }
  viewsRoot.replaceChildren(...rows);
  viewsNavigation.refresh();
}

function viewRow(
  view: WorkspaceViewRowWire,
  current: WorkspacePanelStateWire,
): HTMLElement {
  const row = htmlElement("button", "workspace-row");
  row.type = "button";
  const expandable = view.id === "due" && current.dueToday.length > 0;
  if (expandable) {
    const open = expanded.has(DUE_TODAY_KEY);
    const twisty = codicon(open ? "chevron-down" : "chevron-right");
    twisty.classList.add("row-twisty");
    row.append(twisty);
    // Only a row that can open says so; nothing due means nothing to announce as closed.
    row.setAttribute("aria-expanded", String(open));
    row.dataset.expandKey = DUE_TODAY_KEY;
    row.addEventListener("keydown", (event) => {
      /*
       * ArrowRight opens and ArrowLeft closes, the tree convention rather than one key that
       * toggles — so a reader holding an arrow down cannot shut the list they just opened.
       * Enter and Space are left alone; they still open the Tasks view.
       */
      if (event.key !== (open ? "ArrowLeft" : "ArrowRight")) return;
      event.preventDefault();
      toggleExpanded(DUE_TODAY_KEY);
    });
  }
  const icon = codicon(view.icon);
  /*
   * The hue is the view's own, carried by its id, and the tone is its state. They are separate
   * on purpose: an icon that changed colour whenever something needed attention would leave
   * the row unrecognisable at rest, and one that never changed would lose the signal. The icon
   * says which view this is; the count beside it says whether it wants anything.
   */
  icon.classList.add("row-icon", `is-${view.id}`);
  row.append(icon, htmlElement("span", "workspace-row-label", view.label));
  if (view.count !== undefined) {
    row.append(
      htmlElement("span", `workspace-row-count is-${view.tone}`, String(view.count)),
    );
  }
  row.title = view.count === undefined ? view.label : `${view.label} · ${view.count}`;
  row.addEventListener("click", (event) => {
    // The twisty opens the list in place; the row itself opens the view.
    if (expandable && event.target instanceof Element && event.target.closest(".row-twisty")) {
      toggleExpanded(DUE_TODAY_KEY);
      return;
    }
    api.postMessage({ type: "workspace/openView", id: view.id });
  });
  return row;
}

function taskRow(task: WorkspaceTaskRowWire, version: number): HTMLElement {
  const text = task.text.length > 0 ? task.text : "Untitled task";
  /*
   * A div, not a label. A label forwards a click anywhere in the row to its checkbox, so the
   * text had to cancel the default to open the note instead — and the text could then only
   * ever be a span, which no keyboard can reach. The tasks view settled this the same way and
   * for the same reason: the checkbox and the text each keep their own target.
   */
  const row = htmlElement(
    "div",
    task.completed ? "workspace-task is-completed" : "workspace-task",
  );
  row.title = `${text}\n${task.noteTitle}`;
  const checkbox = htmlElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = task.completed;
  checkbox.setAttribute("aria-label", task.completed ? `Reopen ${text}` : `Complete ${text}`);
  checkbox.dataset.taskUri = task.noteUri;
  checkbox.dataset.taskStart = String(task.start);
  checkbox.addEventListener("change", () => {
    pendingTaskFocus = { uri: task.noteUri, start: task.start };
    checkbox.disabled = true;
    api.postMessage({
      type: "workspace/toggleTask",
      noteUri: task.noteUri,
      start: task.start,
      ...(task.id === undefined ? {} : { taskId: task.id }),
      completed: task.completed,
      version,
    });
  });
  const label = htmlElement("button", "workspace-task-text", text);
  label.type = "button";
  label.title = `${text}\nOpen in ${task.noteTitle}`;
  label.addEventListener("click", () => {
    api.postMessage({ type: "workspace/revealTask", noteUri: task.noteUri, start: task.start });
  });
  const urgency = task.completed ? "none" : dueUrgency(task.due);
  row.append(
    checkbox,
    label,
    htmlElement("span", `workspace-task-dot is-${urgency}`),
  );
  return row;
}

/**
 * What the filtered list last drew. A filter paint can be asked for more than once with the
 * same outcome — the index republishing mid-typing, a content answer that widens nothing —
 * and rebuilding a few hundred identical rows makes the list shimmer. Identical rows stay.
 */
let filteredListSignature: string | undefined;

/**
 * Folders, then the notes beside them. Filtering flattens the tree: when a query is on, every
 * matching note is listed wherever it lives, because "where is that note" is the question the
 * field is being asked.
 *
 * Unfiltered, the tree draws only what is open — a folder's subfolders and its own notes,
 * never its whole subtree. That is fewer rows than the panel used to draw, not more: opening
 * `projects` in a nested vault used to spill every note beneath it into one flat run and hit
 * the row limit immediately, so the first thing browsing said was "narrow the search".
 */
function renderNotes(current: WorkspacePanelStateWire): void {
  noteCount.textContent = String(current.noteCount);
  const filtering = filter.value.trim().length > 0;
  const contentUris = contentMatches?.query === filter.value.trim()
    ? contentMatches.uris
    : undefined;
  const visible = current.notes.filter((note) =>
    matches(`${note.title} ${note.path}`) || (contentUris?.has(note.uri) ?? false));
  filterStatus.textContent = filtering
    ? `${visible.length} note${visible.length === 1 ? "" : "s"} match`
    : "";
  // Over every note, not only the drawn ones: a title is ambiguous because of a note elsewhere.
  const qualifiers = noteRowQualifiers(current.notes);

  if (filtering) {
    const signature = visible
      .map((note) => `${note.uri}|${note.title}|${note.path}|${note.links}`)
      .join("\n");
    if (signature === filteredListSignature) {
      // The rows can stay, but which of them is the current note may still have moved.
      markActiveNote();
      return;
    }
    filteredListSignature = signature;
    notesRoot.replaceChildren(...(visible.length === 0
      ? [htmlElement("p", "workspace-empty", "No notes match.")]
      : capped(visible.map((note) => noteRow(note, 1, qualifiers)), visible.length)));
    notesNavigation.refresh();
    return;
  }
  filteredListSignature = undefined;

  const rows = workspaceTreeRows(current.folders, current.notes, isFolderExpanded).map((row) =>
    row.kind === "folder"
      ? folderRow(row.folder, row.depth)
      : noteRow(row.note, row.depth, qualifiers));
  notesRoot.replaceChildren(...(rows.length === 0
    ? emptyNotes(current)
    : capped(rows, rows.length)));
  notesNavigation.refresh();
}

function isFolderExpanded(path: string): boolean {
  return expanded.has(folderKey(path));
}

/**
 * The expansion key a folder is remembered under. Nested paths need no new persistence — the
 * key is the path, and `api.setState` already carries whatever strings are in the set across a
 * reload — but the two places that build it must agree, so only this one builds it.
 */
function folderKey(path: string): string {
  return `folder:${path}`;
}

/**
 * What stands in for the note list when there is none. The wording is chosen away from here,
 * in `workspaceEmptyState`, because which sentence is true depends on the workspace and only
 * one of the two has anything to click.
 */
function emptyNotes(current: WorkspacePanelStateWire): HTMLElement[] {
  const empty = workspaceEmptyState(current.hasWorkspaceFolder, current.noteCount);
  if (empty === undefined) return [];
  const panel = emptyState(empty.icon, empty.message, empty.hint);
  const action = empty.action;
  if (action !== undefined) {
    const button = htmlElement("button", "primary-button empty-state-action", action.label);
    button.type = "button";
    button.addEventListener("click", () =>
      api.postMessage({ type: "workspace/runCommand", command: action.command }));
    panel.append(button);
  }
  return [panel];
}

function folderRow(folder: WorkspaceFolderRowWire, depth: number): HTMLElement {
  const row = htmlElement("button", "workspace-row");
  row.type = "button";
  const open = isFolderExpanded(folder.path);
  const twisty = codicon(open ? "chevron-down" : "chevron-right");
  twisty.classList.add("row-twisty");
  row.append(
    twisty,
    htmlElement("span", "workspace-row-label", folder.label),
    htmlElement("span", "workspace-row-count", String(folder.count)),
  );
  indent(row, depth);
  row.setAttribute("aria-expanded", String(open));
  // Announced as a tree row so its level is spoken; a flat list of buttons could not say it.
  row.setAttribute("aria-level", String(depth + 1));
  row.title = `${folder.path} · ${folder.count} note${folder.count === 1 ? "" : "s"}`;
  row.dataset.expandKey = folderKey(folder.path);
  row.addEventListener("click", () => toggleExpanded(folderKey(folder.path)));
  /*
   * ArrowRight opens and ArrowLeft closes, the same tree convention Due Today uses — so a
   * reader holding an arrow down a deep tree cannot shut the folder they just opened.
   */
  row.addEventListener("keydown", (event) => {
    if (event.key !== (open ? "ArrowLeft" : "ArrowRight")) return;
    event.preventDefault();
    event.stopPropagation();
    toggleExpanded(folderKey(folder.path));
  });
  return row;
}

/**
 * How far in a row sits. A calc rather than a class per level: the tree is as deep as the
 * vault is, and `.is-nested` could only ever say "one level in".
 */
function indent(row: HTMLElement, depth: number): void {
  if (depth > 0) row.style.setProperty("--row-depth", String(depth));
}

/** Trims a row list to what the panel will actually draw, and says what was left out. */
function capped(rows: readonly HTMLElement[], total: number): HTMLElement[] {
  if (rows.length <= VISIBLE_NOTE_LIMIT) return [...rows];
  const shown = rows.slice(0, VISIBLE_NOTE_LIMIT);
  const remaining = total - VISIBLE_NOTE_LIMIT;
  shown.push(htmlElement(
    "p",
    "workspace-empty",
    `${remaining} more — narrow the search to see them.`,
  ));
  return shown;
}

function noteRow(
  note: WorkspaceNoteRowWire,
  depth: number,
  qualifiers: ReadonlyMap<string, string>,
): HTMLElement {
  const classes = ["workspace-row"];
  if (note.uri === activeNoteUri) classes.push("is-active");
  const row = htmlElement("button", classes.join(" "));
  row.type = "button";
  row.dataset.uri = note.uri;
  indent(row, depth);
  const strength = note.links >= 3 ? "" : note.links > 0 ? " is-weak" : " is-orphan";
  row.append(
    htmlElement("span", `workspace-note-dot${strength}`),
    htmlElement("span", "workspace-row-label", note.title),
  );
  /*
   * Where it lives, but only when the title does not say which note this is. Four `index.md`
   * files under four projects drew four identical rows, and hovering each in turn was the only
   * way to tell them apart. Every row carrying its folder would be noise in a column this
   * narrow, so only the ambiguous ones do — see `noteRowQualifiers` for how much is enough.
   */
  const qualifier = qualifiers.get(note.uri);
  if (qualifier !== undefined) {
    row.append(htmlElement("span", "workspace-row-parent", qualifier));
  }
  if (note.links > 0) {
    row.append(htmlElement("span", "workspace-note-count", String(note.links)));
  }
  row.title = `${note.title}\n${note.path}\n${note.links} link${note.links === 1 ? "" : "s"}`;
  row.addEventListener("click", () => api.postMessage({ type: "workspace/openNote", uri: note.uri }));
  row.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    openNoteMenu(row, note, event);
  });
  return row;
}

/**
 * The menu a note offers besides opening it.
 *
 * A webview gets no say in VS Code's own context menu — `contributes.menus` reaches tree items
 * and editor tabs, not the inside of a panel — so right-clicking a note used to rename it
 * outright, with no menu and nothing else on offer. This is that menu.
 */
const NOTE_MENU_MARGIN = 6;

for (const item of noteMenuItems) {
  item.addEventListener("click", () => {
    const target = menuNote;
    const action = item.dataset.action;
    closeNoteMenu(false);
    if (target === undefined) return;
    if (action === "rename" || action === "graph" || action === "delete") {
      api.postMessage({ type: "workspace/noteAction", action, uri: target.uri });
    }
  });
}

noteMenu.addEventListener("keydown", (event) => {
  const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
  if (step === 0) return;
  event.preventDefault();
  const at = noteMenuItems.indexOf(document.activeElement as HTMLButtonElement);
  const next = (at + step + noteMenuItems.length) % noteMenuItems.length;
  noteMenuItems[next]?.focus();
});

document.addEventListener("keydown", (event) => {
  if (noteMenu.hidden || (event.key !== "Escape" && event.key !== "Tab")) return;
  event.preventDefault();
  closeNoteMenu(true);
});
// Anywhere but the menu dismisses it — including a right-click, which opens the next one.
document.addEventListener("mousedown", (event) => {
  if (noteMenu.hidden || (event.target instanceof Node && noteMenu.contains(event.target))) return;
  closeNoteMenu(false);
}, true);
// The menu is placed against the pointer, so anything that moves the list underneath it lies.
window.addEventListener("blur", () => closeNoteMenu(false));
window.addEventListener("resize", () => closeNoteMenu(false));
requireElement("#workspace-body", HTMLElement).addEventListener(
  "scroll",
  () => closeNoteMenu(false),
);

function openNoteMenu(
  row: HTMLElement,
  note: WorkspaceNoteRowWire,
  event: MouseEvent,
): void {
  menuNote = { uri: note.uri, row };
  noteMenuTitle.textContent = note.title;
  row.classList.add("is-menu-target");
  noteMenu.hidden = false;

  /*
   * The keyboard's own menu key raises this same event with no pointer behind it, so the menu
   * falls back to the row it was raised from rather than pinning itself to the top-left corner.
   */
  const rowRect = row.getBoundingClientRect();
  const keyboard = event.clientX <= 0 && event.clientY <= 0;
  const point = keyboard
    ? { x: rowRect.left + 12, y: rowRect.bottom }
    : { x: event.clientX, y: event.clientY };

  const shellRect = shell.getBoundingClientRect();
  const menuRect = noteMenu.getBoundingClientRect();
  // Flipped rather than merely nudged when it would overhang, so it never covers its own row.
  const left = point.x + menuRect.width + NOTE_MENU_MARGIN > shellRect.right
    ? point.x - menuRect.width
    : point.x;
  const top = point.y + menuRect.height + NOTE_MENU_MARGIN > shellRect.bottom
    ? point.y - menuRect.height
    : point.y;
  noteMenu.style.left = `${clamp(left - shellRect.left, shellRect.width - menuRect.width)}px`;
  noteMenu.style.top = `${clamp(top - shellRect.top, shellRect.height - menuRect.height)}px`;

  noteMenuItems[0]?.focus();
}

function clamp(value: number, most: number): number {
  return Math.max(NOTE_MENU_MARGIN, Math.min(value, most - NOTE_MENU_MARGIN));
}

/** Closes the menu, returning focus to the note it belonged to when the keyboard dismissed it. */
function closeNoteMenu(restoreFocus: boolean): void {
  if (noteMenu.hidden) return;
  noteMenu.hidden = true;
  const row = menuNote?.row;
  menuNote = undefined;
  row?.classList.remove("is-menu-target");
  if (restoreFocus && row !== undefined && row.isConnected) row.focus();
}

function renderTags(current: WorkspacePanelStateWire): void {
  const visible = current.tags.filter((tag) => matches(tag.name));
  tagsRoot.replaceChildren(...(visible.length === 0
    ? [htmlElement("p", "workspace-empty", "No tags yet.")]
    : visible.map((tag) => {
      const chip = htmlElement("button", "workspace-tag");
      chip.type = "button";
      chip.title = `#${tag.name} · ${tag.count} note${tag.count === 1 ? "" : "s"}`;
      const dot = htmlElement("span", "workspace-tag-dot");
      dot.style.setProperty("--tag-hue", tagHueColor(tag.name));
      // The name carries the ellipsis when it is too long for the panel, and a bare text node
      // cannot: it becomes an anonymous flex item, which text-overflow has no hold on.
      chip.append(
        dot,
        htmlElement("span", "workspace-tag-label", tag.name),
        htmlElement("span", "workspace-tag-count", String(tag.count)),
      );
      chip.addEventListener("click", () => api.postMessage({ type: "workspace/openTag", tag: tag.name }));
      return chip;
    })));
}

/*
 * The footer counts what the index holds, so it is also where the index has to admit what it
 * left out. A note past `vispNotes.maxNoteSizeKB` is not read, and until now nothing anywhere
 * said so: the note simply was not in this list, its links were reported broken, and the
 * reader had no way from either symptom to the setting that caused them.
 *
 * The tally goes in the row's text beside the note and task counts, because that count
 * disagreeing with the number of files in the folder is the complaint; the sentence explaining
 * it goes on the row's tooltip, which is the only room this footer has. Both come from
 * `oversizedNotes`, which the status bar item also reads — the two sit in the same window and a
 * reader compares them.
 */
function renderStatus(current: WorkspacePanelStateWire): void {
  statusRow.dataset.state = current.status;
  const skipped = current.skippedOversized;
  statusText.textContent = current.status === "error"
    ? "Index needs attention"
    : `${current.noteCount} note${current.noteCount === 1 ? "" : "s"} · ${
      current.taskCount
    } task${current.taskCount === 1 ? "" : "s"}${
      skipped.length === 0 ? "" : ` · ${oversizedTally(skipped.length)}`
    }`;
  statusIndexed.textContent = current.status === "indexing"
    ? "indexing…"
    : formatIndexedAt(current.indexedAt) ?? "";
  const reason = oversizedReason(skipped);
  statusRow.title = reason ?? "";
  statusDot.title = statusText.textContent;
}

/**
 * The host is trusted less than it could be, on purpose: a malformed element inside one of
 * these arrays would otherwise reach a renderer and throw mid-DOM-build, leaving the panel
 * half drawn with no way back. Checking the elements is cheap next to rendering them.
 */
function isPanelState(value: unknown): value is WorkspacePanelStateWire {
  return (
    isRecord(value) &&
    (value.density === "comfortable" || value.density === "compact") &&
    typeof value.hasWorkspaceFolder === "boolean" &&
    isCount(value.noteCount) &&
    isCount(value.taskCount) &&
    isCount(value.indexedAt) &&
    isCount(value.version) &&
    (value.status === "idle" || value.status === "indexing" || value.status === "error") &&
    (value.activeNoteUri === undefined || typeof value.activeNoteUri === "string") &&
    every(value.views, isViewRow) &&
    every(value.dueToday, isTaskRow) &&
    every(value.folders, isFolderRow) &&
    every(value.notes, isNoteRow) &&
    every(value.tags, isTagRow) &&
    every(value.skippedOversized, isSkippedNote)
  );
}

function every(value: unknown, check: (entry: unknown) => boolean): boolean {
  return Array.isArray(value) && value.every(check);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isViewRow(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.label === "string" &&
    typeof value.icon === "string" &&
    (value.count === undefined || isCount(value.count)) &&
    (value.tone === "default" || value.tone === "brand" || value.tone === "warning")
  );
}

function isTaskRow(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.noteUri === "string" &&
    typeof value.noteTitle === "string" &&
    typeof value.text === "string" &&
    typeof value.completed === "boolean" &&
    isCount(value.start) &&
    (value.id === undefined || typeof value.id === "string") &&
    (value.due === undefined || typeof value.due === "string")
  );
}

/**
 * A folder row, checked for a tree that is actually a tree.
 *
 * `depth` and `parent` have to agree with the path, because the renderer walks parents to
 * decide what is drawn: a row claiming a parent that is not its own prefix could name a
 * descendant, and the walk would then follow itself forever with the panel half drawn.
 */
function isFolderRow(value: unknown): boolean {
  if (
    !isRecord(value) ||
    typeof value.path !== "string" ||
    typeof value.label !== "string" ||
    !isCount(value.count) ||
    !isCount(value.depth)
  ) {
    return false;
  }
  const cut = value.path.lastIndexOf("/");
  return cut === -1
    ? value.depth === 0 && value.parent === undefined
    : value.depth === value.path.split("/").length - 1 && value.parent === value.path.slice(0, cut);
}

function isNoteRow(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.uri === "string" &&
    typeof value.title === "string" &&
    typeof value.path === "string" &&
    typeof value.folder === "string" &&
    isCount(value.links)
  );
}

function isTagRow(value: unknown): boolean {
  return isRecord(value) && typeof value.name === "string" && isCount(value.count);
}

function isSkippedNote(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.uri === "string" &&
    typeof value.path === "string" &&
    isCount(value.sizeBytes) &&
    isCount(value.limitBytes)
  );
}
