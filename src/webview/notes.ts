import type { NoteListRowWire, NotesStateWire, NotesToHostWire } from "./contracts.js";
import { codicon, htmlElement, isRecord, requireElement, setNotice } from "./shared/dom.js";
import { acquireWebviewApi } from "./shared/vscodeApi.js";
import { formatIndexedAt } from "../application/indexFreshness.js";

/**
 * The note list.
 *
 * Two lists share this view — orphan notes, and links that land nowhere — because they are the
 * same shape: a note, something quiet about it, and a way in. Which one is showing comes from
 * the host, so the panel decides nothing except what the filter hides.
 */

const api = acquireWebviewApi<NotesToHostWire, unknown>();
const title = requireElement("#note-view-title", HTMLElement);
const summary = requireElement("#note-summary", HTMLElement);
const search = requireElement("#note-search", HTMLInputElement);
const rowsRoot = requireElement("#note-rows", HTMLElement);
const countText = requireElement("#note-count", HTMLElement);
const errorNotice = requireElement("#notes-error", HTMLElement);

const TITLES: Readonly<Record<NotesStateWire["mode"], string>> = {
  orphans: "Orphan Notes",
  broken: "Broken Links",
};

/** An empty list is good news for both of these, so it says so rather than showing nothing. */
const EMPTY: Readonly<Record<NotesStateWire["mode"], string>> = {
  orphans: "Every note is connected to another.",
  broken: "Every wiki link lands somewhere.",
};

const ICONS: Readonly<Record<NotesStateWire["mode"], string>> = {
  orphans: "circle-slash",
  broken: "warning",
};

let state: NotesStateWire | undefined;

search.addEventListener("input", render);
search.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && search.value.length > 0) {
    event.preventDefault();
    search.value = "";
    render();
  }
});
window.addEventListener("message", (event: MessageEvent<unknown>) => {
  const message = event.data;
  if (!isRecord(message) || typeof message.type !== "string") return;
  if (message.type === "notes/state" && isNotesState(message.state)) {
    state = message.state;
    setNotice(errorNotice);
    render();
  } else if (message.type === "notes/error" && typeof message.message === "string") {
    setNotice(errorNotice, message.message);
  }
});

render();
api.postMessage({ type: "notes/ready" });

function render(): void {
  const current = state;
  if (current === undefined) {
    rowsRoot.replaceChildren(htmlElement("p", "notes-empty", "Building the index…"));
    return;
  }
  title.textContent = TITLES[current.mode];

  const query = search.value.trim().toLocaleLowerCase();
  const visible = query.length === 0
    ? current.rows
    : current.rows.filter((row) =>
      [row.title, row.path, row.detail ?? ""].join(" ").toLocaleLowerCase().includes(query));

  rowsRoot.replaceChildren(...(visible.length === 0
    ? [htmlElement("p", "notes-empty", query.length === 0
      ? EMPTY[current.mode]
      : "Nothing matches that filter.")]
    : visible.map((row) => noteRow(row, current.mode))));

  const total = current.rows.length;
  summary.textContent = total === 0
    ? EMPTY[current.mode]
    : `${total} ${current.mode === "broken" ? "broken link" : "note"}${total === 1 ? "" : "s"}`;
  countText.textContent = query.length === 0 || visible.length === total
    ? `${total} shown · indexed ${formatIndexedAt(current.indexedAt)}`
    : `${visible.length} of ${total} shown · indexed ${formatIndexedAt(current.indexedAt)}`;
}

function noteRow(row: NoteListRowWire, mode: NotesStateWire["mode"]): HTMLElement {
  const button = htmlElement("button", "note-row");
  button.type = "button";
  button.append(codicon(ICONS[mode]), htmlElement("span", "note-row-title", row.title));
  if (row.detail !== undefined) {
    button.append(htmlElement("span", "note-row-detail", row.detail));
  }
  button.append(htmlElement("span", "note-row-path", row.path));
  if (row.line !== undefined) {
    button.append(htmlElement("span", "note-row-line", `:${row.line}`));
  }
  button.title = [row.title, row.path, row.detail].filter(Boolean).join("\n");
  button.addEventListener("click", () => api.postMessage({
    type: "notes/open",
    uri: row.uri,
    ...(row.start === undefined ? {} : { start: row.start }),
  }));
  return button;
}

function isNotesState(value: unknown): value is NotesStateWire {
  return isRecord(value) &&
    (value.mode === "orphans" || value.mode === "broken") &&
    typeof value.indexedAt === "number" &&
    Array.isArray(value.rows) &&
    value.rows.every((row: unknown) => isRecord(row) &&
      typeof row.uri === "string" &&
      typeof row.title === "string" &&
      typeof row.path === "string");
}
