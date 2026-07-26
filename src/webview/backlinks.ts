import type {
  BacklinksStateWire,
  BacklinksToHostWire,
  BacklinkWire,
} from "./contracts.js";
import {
  codicon,
  emptyState,
  htmlElement,
  isRecord,
  requireElement,
  statChip,
} from "./shared/dom.js";
import { acquireMessageSender } from "./shared/vscodeApi.js";

const api = acquireMessageSender<BacklinksToHostWire>();
const title = requireElement("#backlinks-title", HTMLHeadingElement);
const stats = requireElement("#backlinks-stats", HTMLElement);
const mentionsLabel = requireElement("#mentions-label", HTMLElement);
const list = requireElement("#backlinks-list", HTMLElement);

let state: BacklinksStateWire | undefined;

list.addEventListener("click", handleOpen);
window.addEventListener("message", handleHostMessage);
render();
api.postMessage({ type: "backlinks/ready" });

function handleHostMessage(event: MessageEvent<unknown>): void {
  const message = event.data;
  if (isRecord(message) && message.type === "backlinks/state" && isBacklinksState(message.state)) {
    state = message.state;
    render();
  }
}

function render(): void {
  if (state === undefined) {
    // No note is active yet, so say what to do rather than showing an empty panel.
    title.textContent = "No note selected";
    mentionsLabel.textContent = "Linked mentions";
    stats.replaceChildren();
    list.replaceChildren(emptyState(
      "book",
      "Open a Markdown note to see which notes link to it.",
    ));
    return;
  }
  const noteTitle = state.noteTitle ?? "Current note";
  const total = state.backlinks.length;
  title.textContent = noteTitle;
  // The editor's context strip carries these too, but a note opened in VS Code's own text
  // editor has no strip, so the panel stays the one place that always reports them.
  stats.replaceChildren(
    statChip("references", total, "backlink", "backlinks"),
    statChip("link", state.outgoingCount, "link out", "links out"),
    statChip("checklist", state.taskCount, "task", "tasks"),
  );
  mentionsLabel.textContent = total === 1 ? "1 linked mention" : `${total} linked mentions`;
  list.replaceChildren();
  if (total === 0) {
    list.append(emptyState(
      "link",
      "No notes link here yet.",
      `Type [[${noteTitle}]] in another note to create the first link.`,
    ));
    return;
  }
  list.append(...state.backlinks.map((backlink) => createBacklinkCard(backlink, noteTitle)));
}

function createBacklinkCard(backlink: BacklinkWire, noteTitle: string): HTMLButtonElement {
  const card = htmlElement("button", "backlink-card");
  card.type = "button";
  card.dataset.uri = backlink.sourceUri;
  card.dataset.start = String(backlink.range.start);
  card.setAttribute("aria-label", `Open mention in ${backlink.sourceTitle}, line ${backlink.line + 1}`);

  const header = htmlElement("span", "backlink-card-header");
  header.append(
    codicon("note"),
    htmlElement("strong", undefined, backlink.sourceTitle),
    htmlElement("span", "backlink-location", `${backlink.sourcePath}:${backlink.line + 1}`),
  );
  const context = htmlElement("span", "backlink-context");
  appendHighlightedText(context, backlink.context, noteTitle);
  card.append(header, context);
  return card;
}

function appendHighlightedText(container: HTMLElement, text: string, needle: string): void {
  const normalizedNeedle = needle.trim();
  if (normalizedNeedle.length === 0) {
    container.textContent = text;
    return;
  }
  const haystack = text.toLocaleLowerCase();
  const query = normalizedNeedle.toLocaleLowerCase();
  let cursor = 0;
  while (cursor < text.length) {
    const match = haystack.indexOf(query, cursor);
    if (match === -1) {
      container.append(document.createTextNode(text.slice(cursor)));
      break;
    }
    if (match > cursor) {
      container.append(document.createTextNode(text.slice(cursor, match)));
    }
    container.append(htmlElement("mark", undefined, text.slice(match, match + normalizedNeedle.length)));
    cursor = match + normalizedNeedle.length;
  }
}

function handleOpen(event: MouseEvent): void {
  if (!(event.target instanceof Element)) {
    return;
  }
  const card = event.target.closest<HTMLButtonElement>(".backlink-card");
  const uri = card?.dataset.uri;
  const start = Number(card?.dataset.start);
  if (uri !== undefined && Number.isFinite(start)) {
    api.postMessage({ type: "backlinks/open", uri, start });
  }
}

function isBacklinksState(value: unknown): value is BacklinksStateWire {
  return (
    isRecord(value) &&
    Array.isArray(value.backlinks) &&
    value.backlinks.every(isBacklink) &&
    isOffset(value.outgoingCount) &&
    isOffset(value.taskCount) &&
    (value.noteUri === undefined || typeof value.noteUri === "string") &&
    (value.noteTitle === undefined || typeof value.noteTitle === "string")
  );
}

function isBacklink(value: unknown): value is BacklinkWire {
  return (
    isRecord(value) &&
    typeof value.sourceUri === "string" &&
    typeof value.sourceTitle === "string" &&
    typeof value.sourcePath === "string" &&
    typeof value.targetUri === "string" &&
    typeof value.context === "string" &&
    isOffset(value.line) &&
    isRecord(value.range) &&
    isOffset(value.range.start) &&
    isOffset(value.range.end) &&
    value.range.start <= value.range.end
  );
}

function isOffset(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
