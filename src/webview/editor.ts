import type {
  EditorDocumentStateWire,
  EditorStateWire,
  EditorToHostWire,
  NoteContextWire,
  NoteSuggestionWire,
} from "./contracts.js";
import { CodeMirrorEditor } from "./editor/codeMirrorEditor.js";
import type { MarkdownEditorMode } from "./editor/codeMirrorEditor.js";
import { DocumentSyncModel } from "./editor/documentSync.js";
import type { DocumentSyncAction, HostStateTransition } from "./editor/documentSync.js";
import type { TextPatch } from "../application/textPatch.js";
import {
  editorContentWidthFromState,
  parseEditorContentWidth,
  stateWithEditorContentWidth,
} from "./editor/contentWidth.js";
import type { EditorContentWidth } from "./editor/contentWidth.js";
import {
  fitsEditorSourceMessage,
  SOURCE_LIMIT_MESSAGE,
} from "./editor/messageLimits.js";
import {
  isEditorDocumentState,
  isEditorState,
  isNoteSuggestions,
  isUnresolvedLinks,
} from "./editor/validation.js";
import { planTagAddition, planTagRemoval } from "../application/noteMetadataEdits.js";
import { parseProseFont } from "../application/proseFont.js";
import { codicon, isRecord, requireElement, setNotice, statChip } from "./shared/dom.js";
import { acquireWebviewApi } from "./shared/vscodeApi.js";

const api = acquireWebviewApi<EditorToHostWire, unknown>();
const title = requireElement("#note-title", HTMLHeadingElement);
const insertLink = requireElement("#insert-link", HTMLButtonElement);
const retrySync = requireElement("#retry-sync", HTMLButtonElement);
const editorWidth = requireElement("#editor-width", HTMLSelectElement);
const liveMode = requireElement("#live-mode", HTMLButtonElement);
const markdownMode = requireElement("#markdown-mode", HTMLButtonElement);
const editorHost = requireElement("#editor-host", HTMLElement);
const breadcrumb = requireElement("#note-breadcrumb", HTMLElement);
const noteTags = requireElement("#note-tags", HTMLElement);
const noteStats = requireElement("#note-stats", HTMLElement);
const syncStatus = requireElement("#sync-status", HTMLElement);
const syncStatusIcon = requireElement("#sync-status-icon", HTMLElement);
const syncStatusText = requireElement("#sync-status-text", HTMLElement);
const errorNotice = requireElement("#editor-error", HTMLElement);
const conflictNotice = requireElement("#editor-conflict", HTMLElement);
const cspNonce = requireCspNonce();

const sync = new DocumentSyncModel();
let editor: CodeMirrorEditor | undefined;
let suggestions: readonly NoteSuggestionWire[] = [];
let unresolvedLinks: ReadonlySet<string> = new Set();
let pendingReveal: number | undefined;
let lastStashedSource: string | undefined;
let lastStashedSaveRequested = false;

insertLink.disabled = true;
insertLink.addEventListener("click", requestLink);
retrySync.addEventListener("click", requestSave);
editorWidth.addEventListener("change", () => {
  const contentWidth = parseEditorContentWidth(editorWidth.value);
  setContentWidth(contentWidth);
  api.postMessage({ type: "editor/setContentWidth", contentWidth });
});
liveMode.addEventListener("click", () => setMode("live"));
markdownMode.addEventListener("click", () => setMode("markdown"));
window.addEventListener("message", handleHostMessage);
window.addEventListener("unload", () => editor?.destroy(), { once: true });

setContentWidth(editorContentWidthFromState(api.getState()));
api.postMessage({ type: "editor/ready" });

function handleHostMessage(event: MessageEvent<unknown>): void {
  const message = event.data;
  if (!isRecord(message) || typeof message.type !== "string") return;

  if (message.type === "editor/state" && isEditorState(message.state)) {
    acceptEditorState(message.state);
  } else if (
    message.type === "editor/documentState" &&
    isEditorDocumentState(message.state)
  ) {
    acceptEditorDocumentState(message.state);
  } else if (message.type === "editor/proseFont") {
    setProseFont(message.fontFamily);
  } else if (message.type === "editor/contentWidth") {
    setContentWidth(parseEditorContentWidth(message.contentWidth));
  } else if (message.type === "editor/toggleMode") {
    setMode(editor?.toggleMode() ?? "live");
  } else if (message.type === "editor/reveal" && typeof message.offset === "number") {
    revealOffset(message.offset);
  } else if (message.type === "editor/insertLink" && typeof message.target === "string") {
    if (sync.snapshot.conflict === undefined && !sync.snapshot.failed) {
      setNotice(errorNotice, editor?.insertWikiLink(message.target));
    }
  } else if (message.type === "editor/insertTag" && typeof message.tag === "string") {
    applyTagEdit(message.tag, "add");
  } else if (message.type === "editor/removeTag" && typeof message.tag === "string") {
    applyTagEdit(message.tag, "remove");
  } else if (
    message.type === "editor/indexState" &&
    isNoteSuggestions(message.suggestions) &&
    isUnresolvedLinks(message.unresolvedLinks)
  ) {
    updateIndexState(message.suggestions, message.unresolvedLinks);
  } else if (
    message.type === "editor/error" &&
    (message.operation === "sync" || message.operation === "link") &&
    typeof message.message === "string"
  ) {
    if (message.operation === "sync") sync.markSubmissionFailed();
    setNotice(errorNotice, message.message);
    updateStatus();
  }
}

function acceptEditorState(nextState: EditorStateWire): void {
  suggestions = nextState.noteSuggestions;
  setContentWidth(parseEditorContentWidth(nextState.contentWidth));
  setProseFont(nextState.proseFont);
  acceptEditorDocumentState(nextState);
  if (nextState.recoveredDraft !== undefined) {
    runTransition(sync.recoverDraft(
      nextState.recoveredDraft.source,
      nextState.recoveredDraft.saveRequested,
    ));
  }
  updateStatus();
}

function acceptEditorDocumentState(nextState: EditorDocumentStateWire): void {
  title.textContent = nextState.title;
  renderNoteContext(nextState.context);
  updateUnresolvedLinks(nextState.unresolvedLinks);
  const transition = sync.onHostState({
    source: nextState.source,
    version: nextState.version,
    dirty: nextState.dirty,
    ...(nextState.acknowledgedSequence === undefined
      ? {}
      : { acknowledgedSequence: nextState.acknowledgedSequence }),
  });
  if (transition.kind !== "conflict" && sync.snapshot.conflict === undefined) {
    hideConflict();
  }
  runTransition(transition);
  updateStatus();
}

function runTransition(transition: HostStateTransition): void {
  if (transition.kind === "conflict") showConflict();
  runActions(transition.actions);
}

function runActions(actions: readonly DocumentSyncAction[]): void {
  for (const action of actions) {
    switch (action.type) {
      case "replace-local":
        mountOrReplaceEditor(action.source);
        break;
      case "save-document":
        api.postMessage({ type: "editor/save" });
        break;
      case "submit-edit":
        if (!fitsEditorSourceMessage(action.patch.source, action.patch.expectedSource)) {
          sync.rejectCurrentEdit();
          setNotice(errorNotice, SOURCE_LIMIT_MESSAGE);
          break;
        }
        api.postMessage({
          type: "editor/editSource",
          start: action.patch.start,
          end: action.patch.end,
          source: action.patch.source,
          expectedSource: action.patch.expectedSource,
          version: action.expectedVersion,
          sequence: action.sequence,
          ...(action.save ? { save: true } : {}),
        });
        break;
    }
  }
  updateStatus();
}

function mountOrReplaceEditor(source: string): void {
  if (editor !== undefined) {
    editor.replaceSource(source);
    return;
  }
  editor = new CodeMirrorEditor(editorHost, cspNonce, source, {
    suggestions: () => suggestions,
    unresolvedLinks: () => unresolvedLinks,
    sourcePatched: handleLocalPatch,
    saveRequested: requestSave,
    openLink: (target, beside) => api.postMessage({
      type: "editor/openLink",
      target,
      ...(beside ? { beside: true } : {}),
    }),
  });
  insertLink.disabled = false;
  if (pendingReveal !== undefined) {
    const offset = pendingReveal;
    pendingReveal = undefined;
    window.requestAnimationFrame(() => editor?.reveal(offset));
  } else {
    window.requestAnimationFrame(() => editor?.focus());
  }
}

function handleLocalPatch(patch: TextPatch): void {
  setNotice(errorNotice);
  runActions(sync.onLocalPatch(patch));
}

function requestSave(): void {
  setNotice(errorNotice);
  if (sync.snapshot.failed) runActions(sync.retry());
  runActions(sync.requestSave());
  if (sync.snapshot.editPending) api.postMessage({ type: "editor/save" });
}

function requestLink(): void {
  if (editor === undefined || sync.snapshot.conflict !== undefined || sync.snapshot.failed) return;
  setNotice(errorNotice);
  api.postMessage({ type: "editor/requestLink" });
}

function setMode(mode: MarkdownEditorMode): void {
  editor?.setMode(mode);
  const live = mode === "live";
  liveMode.classList.toggle("is-active", live);
  liveMode.setAttribute("aria-pressed", String(live));
  markdownMode.classList.toggle("is-active", !live);
  markdownMode.setAttribute("aria-pressed", String(!live));
}

/**
 * Applies the configured prose font, or clears the override so the interface font shows
 * through. The value is re-validated here even though the host already checked it: a
 * window-scoped setting can come from workspace settings, which is to say from a cloned
 * repository, and it ends up in a stylesheet.
 */
function setProseFont(fontFamily: unknown): void {
  const font = parseProseFont(fontFamily);
  if (font === undefined) {
    editorHost.style.removeProperty("--visp-prose-font");
  } else {
    editorHost.style.setProperty("--visp-prose-font", font);
  }
}

function setContentWidth(contentWidth: EditorContentWidth): void {
  editorHost.dataset.contentWidth = contentWidth;
  editorWidth.value = contentWidth;
  // Cached so a reloaded panel paints at the right measure before the host replies.
  api.setState(stateWithEditorContentWidth(api.getState(), contentWidth));
}

function renderNoteContext(context: NoteContextWire | undefined): void {
  if (context === undefined) {
    breadcrumb.replaceChildren();
    noteTags.replaceChildren();
    noteStats.replaceChildren();
    return;
  }

  const crumbs: Node[] = [];
  for (const folder of context.folders) {
    crumbs.push(contextSpan("crumb", folder), contextSpan("crumb-separator", "›"));
  }
  crumbs.push(contextSpan("crumb is-current", context.fileName));
  breadcrumb.replaceChildren(...crumbs);

  const editable = new Set(context.frontmatterTags.map((tag) => tag.toLocaleLowerCase()));
  noteTags.replaceChildren(
    ...context.tags.map((tag) => tagChip(tag, editable.has(tag.toLocaleLowerCase()))),
    addTagChip(),
  );

  noteStats.replaceChildren(
    statChip("references", context.backlinkCount, "backlink", "backlinks"),
    statChip("link", context.outgoingCount, "link out", "links out"),
    statChip(
      "checklist",
      context.openTaskCount,
      `open task of ${context.taskCount}`,
      `open tasks of ${context.taskCount}`,
    ),
  );
}

/**
 * Frontmatter tags get a remove control; an inline `#tag` does not, because removing it
 * would mean rewriting the author's sentence. The tooltip says which kind it is.
 */
function tagChip(tag: string, editable: boolean): HTMLElement {
  if (!editable) {
    const chip = contextSpan("note-tag is-inline", `#${tag}`);
    chip.title = `#${tag} is written in the note body`;
    return chip;
  }
  const chip = document.createElement("span");
  chip.className = "note-tag is-editable";
  chip.append(document.createTextNode(`#${tag}`));
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "note-tag-remove";
  remove.title = `Remove #${tag} from this note`;
  remove.setAttribute("aria-label", `Remove tag ${tag}`);
  remove.append(codicon("close"));
  remove.addEventListener("click", () => applyTagEdit(tag, "remove"));
  chip.append(remove);
  return chip;
}

function addTagChip(): HTMLElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "note-tag note-tag-add";
  button.title = "Add a tag to this note";
  button.setAttribute("aria-label", "Add a tag");
  button.append(codicon("add"));
  button.addEventListener("click", () => {
    if (editor === undefined) return;
    api.postMessage({ type: "editor/requestTag" });
  });
  return button;
}

function applyTagEdit(tag: string, mode: "add" | "remove"): void {
  if (editor === undefined) return;
  setNotice(errorNotice);
  try {
    const result = editor.applyMetadataEdit((source) =>
      mode === "add" ? planTagAddition(source, tag) : planTagRemoval(source, tag));
    if (result.applied) return;
    setNotice(
      errorNotice,
      result.reason ?? `#${tag} is not in this note's frontmatter, so it cannot be removed here.`,
    );
  } catch (error) {
    // The planner refuses YAML it cannot edit safely; surface that rather than guessing.
    setNotice(errorNotice, error instanceof Error ? error.message : String(error));
  }
}

function contextSpan(className: string, text: string): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = className;
  span.textContent = text;
  return span;
}

function revealOffset(offset: number): void {
  if (editor === undefined) {
    pendingReveal = offset;
  } else {
    editor.reveal(offset);
  }
}

function updateIndexState(
  nextSuggestions: readonly NoteSuggestionWire[],
  nextUnresolvedLinks: readonly string[],
): void {
  suggestions = nextSuggestions;
  updateUnresolvedLinks(nextUnresolvedLinks);
}

function updateUnresolvedLinks(nextUnresolvedLinks: readonly string[]): void {
  unresolvedLinks = new Set(nextUnresolvedLinks);
  editor?.refreshPreview();
}

function showConflict(): void {
  const conflict = sync.snapshot.conflict;
  if (conflict === undefined) return;
  editor?.setReadOnly(true);
  const copy = document.createElement("span");
  copy.className = "draft-conflict-copy";
  copy.textContent = `The note changed elsewhere (version ${conflict.version}). Your local edits are preserved.`;
  const useExternal = conflictButton("Use external", () => {
    api.postMessage({ type: "editor/discardDraft", version: conflict.version });
    runActions(sync.useExternal());
    hideConflict();
  });
  const keepLocal = conflictButton("Keep local", () => {
    runActions(sync.keepLocal());
    hideConflict();
  });
  conflictNotice.replaceChildren(copy, useExternal, keepLocal);
  conflictNotice.hidden = false;
}

function conflictButton(label: string, action: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "secondary-button";
  button.textContent = label;
  button.addEventListener("click", action);
  return button;
}

function hideConflict(): void {
  editor?.setReadOnly(false);
  conflictNotice.hidden = true;
  conflictNotice.replaceChildren();
}

function updateStatus(): void {
  const snapshot = sync.snapshot;
  const baseline = snapshot.baseline;
  const conflict = snapshot.conflict !== undefined;
  const protectedDraft = conflict || snapshot.failed;
  const saving = snapshot.savePending || snapshot.saveRequested;
  const applying = snapshot.editPending || snapshot.localDirty;
  const presentation = !snapshot.ready
    ? { state: undefined, icon: "codicon-loading codicon-modifier-spin", text: "Loading…" }
    : conflict
      ? { state: "conflict", icon: "codicon-warning", text: "Conflict — local edits preserved" }
      : snapshot.failed
        ? { state: "error", icon: "codicon-error", text: "Could not sync — retry available" }
        : saving
          ? { state: "syncing", icon: "codicon-sync codicon-modifier-spin", text: "Saving…" }
          : applying
            ? { state: "syncing", icon: "codicon-sync codicon-modifier-spin", text: "Applying…" }
            : baseline?.dirty === true
              ? { state: "unsaved", icon: "codicon-circle-filled", text: "Unsaved" }
              : { state: "saved", icon: "codicon-check", text: "Saved" };

  syncStatusText.textContent = presentation.text;
  syncStatusIcon.className = `codicon ${presentation.icon}`;
  if (presentation.state === undefined) {
    delete syncStatus.dataset.state;
  } else {
    syncStatus.dataset.state = presentation.state;
  }
  syncStatus.title = baseline === undefined
    ? "Waiting for document…"
    : `${presentation.text} · document version ${baseline.version}`;

  // Saving is Ctrl/Cmd+S and the tab's dirty indicator, as in any other editor. A
  // button only appears when a change could not be applied and needs a manual retry.
  retrySync.hidden = !snapshot.failed;
  retrySync.disabled = !snapshot.failed || snapshot.savePending;
  insertLink.disabled = editor === undefined || protectedDraft;
  editor?.setReadOnly(protectedDraft);
  if (protectedDraft) {
    stashProtectedDraft();
  } else {
    lastStashedSource = undefined;
    lastStashedSaveRequested = false;
  }
}

function stashProtectedDraft(): void {
  const snapshot = sync.snapshot;
  const baseline = snapshot.baseline;
  if (
    baseline === undefined ||
    snapshot.localSource === baseline.source ||
    !fitsEditorSourceMessage(snapshot.localSource, "") ||
    (
      lastStashedSource === snapshot.localSource &&
      lastStashedSaveRequested === snapshot.saveRequested
    )
  ) {
    return;
  }
  lastStashedSource = snapshot.localSource;
  lastStashedSaveRequested = snapshot.saveRequested;
  api.postMessage({
    type: "editor/stashDraft",
    source: snapshot.localSource,
    saveRequested: snapshot.saveRequested,
  });
}

function requireCspNonce(): string {
  const nonce = document.body.dataset.cspNonce;
  if (nonce === undefined || nonce.length === 0) {
    throw new Error("The editor CSP nonce is unavailable.");
  }
  return nonce;
}
