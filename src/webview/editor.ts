import type {
  EditorDocumentStateWire,
  EditorStateWire,
  EditorToHostWire,
  NoteSuggestionWire,
} from "./contracts.js";
import { CodeMirrorEditor } from "./editor/codeMirrorEditor.js";
import type { MarkdownEditorMode } from "./editor/codeMirrorEditor.js";
import { DocumentSyncModel } from "./editor/documentSync.js";
import type { DocumentSyncAction, HostStateTransition } from "./editor/documentSync.js";
import type { TextPatch } from "../application/textPatch.js";
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
import { isRecord, requireElement, setNotice } from "./shared/dom.js";
import { acquireMessageSender } from "./shared/vscodeApi.js";

const api = acquireMessageSender<EditorToHostWire>();
const title = requireElement("#note-title", HTMLHeadingElement);
const insertLink = requireElement("#insert-link", HTMLButtonElement);
const saveNote = requireElement("#save-note", HTMLButtonElement);
const liveMode = requireElement("#live-mode", HTMLButtonElement);
const markdownMode = requireElement("#markdown-mode", HTMLButtonElement);
const editorHost = requireElement("#editor-host", HTMLElement);
const syncStatus = requireElement("#sync-status", HTMLElement);
const versionLabel = requireElement("#editor-version", HTMLElement);
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
saveNote.disabled = true;
insertLink.addEventListener("click", requestLink);
saveNote.addEventListener("click", requestSave);
liveMode.addEventListener("click", () => setMode("live"));
markdownMode.addEventListener("click", () => setMode("markdown"));
window.addEventListener("message", handleHostMessage);
window.addEventListener("unload", () => editor?.destroy(), { once: true });

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
  } else if (message.type === "editor/toggleMode") {
    setMode(editor?.toggleMode() ?? "live");
  } else if (message.type === "editor/reveal" && typeof message.offset === "number") {
    revealOffset(message.offset);
  } else if (message.type === "editor/insertLink" && typeof message.target === "string") {
    if (sync.snapshot.conflict === undefined && !sync.snapshot.failed) {
      setNotice(errorNotice, editor?.insertWikiLink(message.target));
    }
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
  const status = !snapshot.ready
    ? "Loading…"
    : conflict
      ? "Conflict — local edits preserved"
      : snapshot.failed
        ? "Synchronization failed — retry available"
        : saving
          ? "Saving…"
          : applying
            ? "Applying…"
            : baseline?.dirty === true ? "Unsaved" : "Saved";
  syncStatus.textContent = status;
  const statusState = !snapshot.ready
    ? undefined
    : conflict
      ? "conflict"
      : snapshot.failed
        ? "error"
        : saving || applying
          ? "syncing"
          : baseline?.dirty === true ? "unsaved" : "saved";
  if (statusState === undefined) {
    delete syncStatus.dataset.state;
  } else {
    syncStatus.dataset.state = statusState;
  }
  versionLabel.textContent = baseline === undefined
    ? "Waiting for document…"
    : `${baseline.dirty ? "Unsaved" : "Saved"} · version ${baseline.version}`;
  saveNote.textContent = snapshot.failed
    ? "Retry"
    : saving ? "Saving…" : baseline?.dirty === true || applying ? "Save" : "Saved";
  saveNote.disabled = !snapshot.ready || conflict || snapshot.savePending ||
    (!snapshot.failed && !applying && baseline?.dirty !== true);
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
