import type { NoteListingWire, NoteListRowWire, NotesStateWire, NotesToHostWire } from "./contracts.js";
import { codicon, emptyState, htmlElement, isRecord, requireElement, setNotice } from "./shared/dom.js";
import { acquireWebviewApi } from "./shared/vscodeApi.js";
import { RovingList, isBareKey } from "./shared/rovingList.js";
import { formatIndexedAt } from "../application/indexFreshness.js";
import { formatNoteRecency, RECENT_LISTING_MEANING } from "../application/noteRecency.js";
import { filterNoteRows, listingKey, parseNoteSort } from "./notes/listing.js";
import { tagHueColor } from "../application/tagHue.js";

/**
 * The note list.
 *
 * Three lists share this view — orphan notes, links that land nowhere, and the notes carrying a
 * tag — because they are the same shape: a note, something quiet about it, and a way in. Which
 * one is showing comes from the host; filtering, sorting, and row density stay local to the panel.
 */

const api = acquireWebviewApi<NotesToHostWire, unknown>();
const title = requireElement("#note-view-title", HTMLElement);
const summary = requireElement("#note-summary", HTMLElement);
const search = requireElement("#note-search", HTMLInputElement);
const rowsRoot = requireElement("#note-rows", HTMLElement);
const countText = requireElement("#note-count", HTMLElement);
const errorNotice = requireElement("#notes-error", HTMLElement);
const tagFilter = requireElement("#note-tag", HTMLSelectElement);
const sortBy = requireElement("#note-sort", HTMLSelectElement);
const density = requireElement("#note-density", HTMLButtonElement);
const clear = requireElement("#note-clear", HTMLButtonElement);
const saved = api.getState();
let savedListing = isRecord(saved) && typeof saved.listing === "string" ? saved.listing : "";
search.value = isRecord(saved) && typeof saved.query === "string" ? saved.query : "";
sortBy.value = parseNoteSort(isRecord(saved) ? saved.sort : undefined);
let selectedTag = isRecord(saved) && typeof saved.tag === "string" ? saved.tag : "";
let compact = isRecord(saved) && saved.compact === true;

const ICONS: Readonly<Record<NoteListingWire["kind"], string>> = {
  orphans: "circle-slash",
  broken: "warning",
  recent: "history",
  tag: "tag",
};

function titleOf(listing: NoteListingWire): string {
  switch (listing.kind) {
    case "orphans": return "Orphan Notes";
    case "broken": return "Broken Links";
    case "recent": return "Recent Notes";
    case "tag": return `#${listing.tag}`;
  }
}

/** An empty list is good news for two of these, so it says so rather than showing nothing. */
function emptyText(listing: NoteListingWire): string {
  switch (listing.kind) {
    case "orphans": return "Every note is connected to another.";
    case "broken": return "Every wiki link lands somewhere.";
    case "recent": return "No note has been written yet.";
    case "tag": return `No note carries #${listing.tag}.`;
  }
}

/** What one row is, for the count along the bottom. */
function nounOf(listing: NoteListingWire): string {
  return listing.kind === "broken" ? "broken link" : "note";
}

let state: NotesStateWire | undefined;

/**
 * The list is one tab stop, and the arrows move inside it. Every row was its own tab stop, so
 * working down a list of 300 broken links meant 300 Tab presses — and the list is rebuilt from
 * scratch whenever the index moves, which dropped focus to the body each time it did.
 */
const rowNavigation = new RovingList(rowsRoot, { rows: ".note-row" });

search.addEventListener("input", render);
sortBy.addEventListener("change", render);
tagFilter.addEventListener("change", () => {
  selectedTag = tagFilter.value;
  render();
});
density.addEventListener("click", () => {
  compact = !compact;
  render();
});
clear.addEventListener("click", clearFilters);

function clearFilters(): void {
  search.value = "";
  selectedTag = "";
  render();
  search.focus();
}
search.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && search.value.length > 0) {
    event.preventDefault();
    search.value = "";
    render();
    return;
  }
  if (!isBareKey(event)) return;
  // Filtering to one row and then having no way to open it is where this list used to end.
  if (event.key === "Enter") {
    event.preventDefault();
    rowNavigation.firstRow()?.click();
  } else if (event.key === "ArrowDown") {
    event.preventDefault();
    rowNavigation.focusFirst();
  }
});
window.addEventListener("message", (event: MessageEvent<unknown>) => {
  const message = event.data;
  if (!isRecord(message) || typeof message.type !== "string") return;
  if (message.type === "notes/state" && isNotesState(message.state)) {
    const key = listingKey(message.state.listing);
    if (savedListing !== key) {
      search.value = "";
      selectedTag = "";
    }
    savedListing = key;
    state = message.state;
    updateTags();
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
    rowsRoot.replaceChildren(emptyState("loading", "Building the note index…"));
    return;
  }
  title.textContent = titleOf(current.listing);
  const defaultSort = sortBy.querySelector('option[value="default"]');
  if (defaultSort !== null) defaultSort.textContent = current.listing.kind === "recent" ? "Last changed" : "Default order";

  const query = search.value.trim();
  const visible = filterNoteRows(current.rows, query, selectedTag, parseNoteSort(sortBy.value));
  const filtered = query !== "" || selectedTag !== "";
  clear.hidden = !filtered;
  rowsRoot.classList.toggle("is-compact", compact);
  density.setAttribute("aria-pressed", String(compact));
  tagFilter.value = selectedTag;
  api.setState({ listing: savedListing, query: search.value, tag: selectedTag, sort: sortBy.value, compact });

  if (visible.length === 0) {
    const empty = emptyState(filtered ? "search" : ICONS[current.listing.kind],
      filtered ? "No notes match these filters." : emptyText(current.listing),
      filtered ? "Try another word or tag, or clear the filters to see this list."
        : current.listing.kind === "recent" ? "Create a note from the Visp Notes sidebar to get started."
          : current.listing.kind === "orphans" ? "Notes without incoming or outgoing links will appear here."
            : current.listing.kind === "broken" ? "Unresolved wiki links will appear here when they need attention."
              : "Add this tag to a note to include it here.");
    if (filtered) {
      const reset = htmlElement("button", "secondary-button empty-state-action", "Clear filters");
      reset.type = "button";
      reset.addEventListener("click", clearFilters);
      empty.append(reset);
    }
    rowsRoot.replaceChildren(empty);
  } else {
    rowsRoot.replaceChildren(...visible.map((row) => noteRow(
      row, current.listing.kind, current.listing.kind === "tag" ? current.listing.tag : undefined,
    )));
  }
  rowNavigation.refresh();

  const total = current.rows.length;
  /*
   * A list ordered by time has to say which clock. "Recent Notes" reads as when you wrote
   * them, and it is when the file was last written — a rename or a find-and-replace across the
   * vault moves notes to the top of it. Said in the summary rather than a tooltip, because a
   * reader who misreads this list will not think to hover anything.
   */
  summary.textContent = total === 0
    ? emptyText(current.listing)
    : current.listing.kind === "recent"
      ? `${total} note${total === 1 ? "" : "s"} · Last changed on disk, not the same as when you wrote it.`
      : `${total} ${nounOf(current.listing)}${total === 1 ? "" : "s"}`;
  summary.title = current.listing.kind === "recent" ? RECENT_LISTING_MEANING : "";
  const counts = !filtered || visible.length === total
    ? `${total} shown`
    : `${visible.length} of ${total} shown`;
  /*
   * `formatIndexedAt` says the word "indexed" itself, and says nothing at all until the first
   * index has finished — so prefixing it printed "indexed indexed just now", and "indexed
   * undefined" on a cold start. The workspace panel already does it this way.
   */
  const freshness = formatIndexedAt(current.indexedAt);
  countText.textContent = freshness === undefined ? counts : `${counts} · ${freshness}`;
}

function updateTags(): void {
  const tags = [...new Set(state?.rows.flatMap((row) => row.tags ?? []) ?? [])]
    .sort((left, right) => left.localeCompare(right));
  if (!tags.includes(selectedTag)) selectedTag = "";
  const all = htmlElement("option", undefined, "All tags");
  all.value = "";
  tagFilter.replaceChildren(all, ...tags.map((tag) => {
    const option = htmlElement("option", undefined, `#${tag}`);
    option.value = tag;
    return option;
  }));
  tagFilter.disabled = tags.length === 0;
}

function noteRow(
  row: NoteListRowWire,
  kind: NoteListingWire["kind"],
  listingTag?: string,
): HTMLElement {
  const button = htmlElement("button", "note-row");
  button.type = "button";
  const icon = codicon(ICONS[kind]);
  if (listingTag !== undefined) {
    // The whole list reads as the tag it is about, so its rows carry that tag's own hue.
    icon.classList.add("is-tag");
    icon.style.setProperty("--tag-hue", tagHueColor(listingTag));
  }
  const content = htmlElement("span", "note-row-content");
  const heading = htmlElement("span", "note-row-heading");
  heading.append(htmlElement("span", "note-row-title", row.title));
  button.append(icon, content);
  content.append(heading);
  if (row.detail !== undefined) {
    heading.append(htmlElement("span", "note-row-detail", row.detail));
  }
  if (row.tags !== undefined && row.tags.length > 0) {
    heading.append(tagChips(row.tags));
  }
  const location = htmlElement("span", "note-row-location");
  location.append(htmlElement("span", "note-row-path", row.path));
  content.append(location);
  if (row.line !== undefined) {
    location.append(htmlElement("span", "note-row-line", `:${row.line}`));
  }
  const changed = row.modifiedAt === undefined ? undefined : formatNoteRecency(row.modifiedAt);
  if (changed !== undefined) {
    const stamp = htmlElement("span", "note-row-when", changed);
    // The exact moment, since the row itself only says roughly.
    stamp.title = row.modifiedAt === undefined ? changed : `Last changed ${absoluteMoment(row.modifiedAt)}`;
    button.append(stamp);
  }
  button.append(codicon("chevron-right"));
  button.title = [row.title, row.path, row.detail, (row.tags ?? []).map((t) => `#${t}`).join(" ")]
    .filter((part) => part !== undefined && part !== "")
    .join("\n");
  button.addEventListener("click", () => api.postMessage({
    type: "notes/open",
    uri: row.uri,
    ...(row.start === undefined ? {} : { start: row.start }),
  }));
  return button;
}

/** The moment in full, for the row's tooltip. The list itself only says roughly. */
function absoluteMoment(at: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(at));
}

/** A note's other tags, each in the hue it wears everywhere else in the extension. */
function tagChips(tags: readonly string[]): HTMLElement {
  const wrapper = htmlElement("span", "note-row-tags");
  for (const tag of tags) {
    const chip = htmlElement("span", "note-row-tag");
    const dot = htmlElement("span", "note-row-tag-dot");
    dot.style.setProperty("--tag-hue", tagHueColor(tag));
    chip.append(dot, document.createTextNode(`#${tag}`));
    wrapper.append(chip);
  }
  return wrapper;
}

/**
 * The host is trusted less than it could be, and this is the seam that fails quietly: a listing
 * kind this does not name is not refused loudly, it is dropped — `state` stays undefined, the
 * panel keeps saying "Building the index…", and nothing anywhere reports a fault. Every member
 * of `NoteListingWire` has to be listed here, and `LISTING_KINDS` is checked against the union
 * by the type checker so that adding a kind and forgetting this line cannot compile.
 */
const LISTING_KINDS: Readonly<Record<NoteListingWire["kind"], true>> = {
  orphans: true,
  broken: true,
  recent: true,
  tag: true,
};

function isNoteListing(value: unknown): value is NoteListingWire {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  if (!Object.hasOwn(LISTING_KINDS, value.kind)) return false;
  return value.kind !== "tag" || typeof value.tag === "string";
}

function isNotesState(value: unknown): value is NotesStateWire {
  return isRecord(value) &&
    isNoteListing(value.listing) &&
    isTimestamp(value.indexedAt) &&
    Array.isArray(value.rows) &&
    value.rows.every((row: unknown) => isRecord(row) &&
      typeof row.uri === "string" &&
      typeof row.title === "string" &&
      typeof row.path === "string" &&
      (row.detail === undefined || typeof row.detail === "string") &&
      (row.tags === undefined || (Array.isArray(row.tags) && row.tags.every((tag) => typeof tag === "string"))) &&
      (row.start === undefined || isOffset(row.start)) &&
      (row.line === undefined || (isOffset(row.line) && row.line > 0)) &&
      (row.modifiedAt === undefined || isTimestamp(row.modifiedAt)));
}

function isOffset(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 8.64e15;
}
