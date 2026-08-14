import type {
  EditorDocumentStateWire,
  EditorMenuCommandWire,
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
  isNoteContext,
  isNoteSuggestions,
  isUnresolvedLinks,
} from "./editor/validation.js";
import { getNoteInspectorElements, renderNoteInspector } from "./editor/noteInspector.js";
import type { NoteInspectorSections } from "./editor/noteInspector.js";
import { planTagAddition, planTagRemoval } from "../application/noteMetadataEdits.js";
import { planTaskToggle } from "../application/taskEditing.js";
import { parseProseFont } from "../application/proseFont.js";
import { tagHueColor } from "../application/tagHue.js";
import { codicon, isRecord, requireElement, setNotice } from "./shared/dom.js";
import { acquireWebviewApi } from "./shared/vscodeApi.js";

const api = acquireWebviewApi<EditorToHostWire, unknown>();
const title = requireElement("#note-title", HTMLHeadingElement);
const liveMode = requireElement("#live-mode", HTMLButtonElement);
const markdownMode = requireElement("#markdown-mode", HTMLButtonElement);
const editorHost = requireElement("#editor-host", HTMLElement);
const editorBody = requireElement(".editor-body", HTMLElement);
const breadcrumb = requireElement("#note-breadcrumb", HTMLElement);
const noteTags = requireElement("#note-tags", HTMLElement);
const noteTagsSummary = requireElement("#note-tags-summary", HTMLButtonElement);
const inspectorToggle = requireElement("#toggle-inspector", HTMLButtonElement);
const inspectorCount = requireElement("#inspector-count", HTMLElement);
const syncStatus = requireElement("#sync-status", HTMLButtonElement);
const syncStatusText = requireElement("#sync-status-text", HTMLElement);
const menuButton = requireElement("#editor-menu-button", HTMLButtonElement);
const menu = requireElement("#editor-menu", HTMLElement);
const brokenLinkHint = requireElement("#broken-link-hint", HTMLElement);
const errorNotice = requireElement("#editor-error", HTMLElement);
const conflictNotice = requireElement("#editor-conflict", HTMLElement);
const widthSegments = Array.from(
  document.querySelectorAll<HTMLButtonElement>("button[data-width]"),
);
const menuItems = Array.from(
  document.querySelectorAll<HTMLButtonElement>("button[data-command]"),
);
const inspector = getNoteInspectorElements();
const bindingHints = Array.from(
  document.querySelectorAll<HTMLElement>(".editor-menu-hint[data-binding]"),
);
const cspNonce = requireCspNonce();

const sync = new DocumentSyncModel();
let editor: CodeMirrorEditor | undefined;
let suggestions: readonly NoteSuggestionWire[] = [];
let unresolvedLinks: ReadonlySet<string> = new Set();
let noteContext: NoteContextWire | undefined;
/**
 * The same context, already serialised. The comparison below ran on both sides on every
 * publish, so the side that had not moved was re-serialised once per keystroke to produce a
 * string it had already produced. Kept beside the value it describes, and written only where
 * that value is.
 */
let noteContextJson: string | undefined;
let inspectorPreference = true;
const roomyPane = window.matchMedia("(min-width: 901px)");
let pendingReveal: number | undefined;
let lastStashedSource: string | undefined;
let lastStashedSaveRequested = false;

liveMode.addEventListener("click", () => setMode("live"));
markdownMode.addEventListener("click", () => setMode("markdown"));
inspectorToggle.addEventListener("click", toggleInspector);
syncStatus.addEventListener("click", requestSave);
menuButton.addEventListener("click", () => setMenuOpen(menu.hidden));
noteTagsSummary.addEventListener("click", () => api.postMessage({ type: "editor/requestTag" }));
for (const item of menuItems) {
  item.addEventListener("click", () => runMenuCommand(item));
}
for (const segment of widthSegments) {
  segment.addEventListener("click", () => {
    /*
     * The menu stays open. Width is a setting being adjusted rather than a command being run,
     * and closing on the first press meant a reader who wanted to compare two widths had to
     * reopen the menu between them — and lost focus each time.
     */
    const contentWidth = parseEditorContentWidth(segment.dataset.width);
    setContentWidth(contentWidth);
    api.postMessage({ type: "editor/setContentWidth", contentWidth });
    segment.focus();
  });
}
document.addEventListener("click", closeMenuOnOutsideClick, true);
document.addEventListener("keydown", closeMenuOnEscape);
window.addEventListener("message", handleHostMessage);
window.addEventListener("unload", () => editor?.destroy(), { once: true });

setContentWidth(editorContentWidthFromState(api.getState()));
renderKeyboardHints();
watchInspectorWidth();
renderInspector();
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
  } else if (message.type === "editor/spelling" && typeof message.enabled === "boolean") {
    editor?.setSpellingEnabled(message.enabled);
  } else if (message.type === "editor/showInspector" && typeof message.showInspector === "boolean") {
    inspectorPreference = message.showInspector;
    applyInspectorVisibility();
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
    updateIndexState(
      message.suggestions,
      message.unresolvedLinks,
      message.brokenLinkCount,
      message.context,
    );
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
  setBrokenLinkCount(nextState.brokenLinkCount);
  inspectorPreference = nextState.showInspector;
  applyInspectorVisibility();
  acceptEditorDocumentState(nextState);
  /*
   * After the document, because that is what creates the editor on the first state message —
   * and the first message is exactly when these matter, since a word accepted in an earlier
   * session should be known before anything is typed.
   */
  editor?.setSpellingEnabled(nextState.spellingEnabled);
  editor?.setPersonalWords(nextState.personalDictionary);
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
  const contextChanged = renderNoteContext(nextState.context);
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
  renderInspector(contextChanged ? "all" : "draft");
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
    renderInspector();
    return;
  }
  editor = new CodeMirrorEditor(editorHost, cspNonce, source, {
    suggestions: () => suggestions,
    unresolvedLinks: () => unresolvedLinks,
    noteTitle: () => title.textContent ?? "",
    sourcePatched: handleLocalPatch,
    saveRequested: requestSave,
    openLink: (target, beside) => api.postMessage({
      type: "editor/openLink",
      target,
      ...(beside ? { beside: true } : {}),
    }),
    openExternal: (url) => api.postMessage({ type: "editor/openExternal", url }),
    addDictionaryWord: (word) => api.postMessage({ type: "editor/addDictionaryWord", word }),
  });
  updateMenuAvailability();
  renderInspector();
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
  // The outline and the task list are the draft's own shape, so they follow every keystroke.
  renderInspector("draft");
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
 * The overflow menu.
 *
 * Insert Link is handled here because it needs the editor's own selection; everything else
 * is a contributed command, so the menu delegates rather than growing a second copy of the
 * behaviour that the command palette already has.
 */
function runMenuCommand(item: HTMLButtonElement): void {
  const command = item.dataset.command;
  setMenuOpen(false);
  if (command === "insertLink") {
    requestLink();
    return;
  }
  if (isMenuCommand(command)) {
    api.postMessage({ type: "editor/runCommand", command });
  }
}

function isMenuCommand(value: string | undefined): value is EditorMenuCommandWire {
  return value === "newTask" || value === "renameNote" || value === "findBrokenLinks" ||
    value === "openLocalGraph" || value === "rebuildIndex";
}

function setMenuOpen(open: boolean): void {
  /*
   * Opening moves focus into the menu, so closing has to put it back — otherwise choosing an
   * item leaves focus on a hidden element, it falls to the body, and the next Tab restarts at
   * the top of the view. Guarded on focus actually being inside, so dismissing the menu by
   * clicking elsewhere does not snatch it back from wherever the reader just went.
   */
  const hadFocusInside = menu.contains(document.activeElement);
  menu.hidden = !open;
  menuButton.setAttribute("aria-expanded", String(open));
  if (open) {
    updateMenuAvailability();
    menu.querySelector<HTMLButtonElement>(".editor-menu-item:not(:disabled)")?.focus();
  } else if (hadFocusInside) {
    menuButton.focus();
  }
}

function updateMenuAvailability(): void {
  const protectedDraft = sync.snapshot.conflict !== undefined || sync.snapshot.failed;
  const insertLink = menu.querySelector<HTMLButtonElement>('[data-command="insertLink"]');
  if (insertLink !== null) {
    insertLink.disabled = editor === undefined || protectedDraft;
  }
}

function closeMenuOnOutsideClick(event: MouseEvent): void {
  if (menu.hidden || !(event.target instanceof Node)) return;
  if (menu.contains(event.target) || menuButton.contains(event.target)) return;
  setMenuOpen(false);
}

function closeMenuOnEscape(event: KeyboardEvent): void {
  if (event.key !== "Escape" || menu.hidden) return;
  event.preventDefault();
  setMenuOpen(false);
  menuButton.focus();
}

/**
 * The menu names one platform's shortcut, the one the reader is on.
 *
 * "Ctrl/Cmd+Shift+L" names both at once and runs to three times the width the design gives
 * the hint column, so it dominated the row it was meant to trail.
 */
function renderKeyboardHints(): void {
  const mac = /Mac|iPhone|iPad/i.test(navigator.userAgent);
  const bindings: Readonly<Record<string, string>> = mac
    ? { insertLink: "\u2318\u21e7L", openLocalGraph: "\u2318\u21e7G" }
    : { insertLink: "Ctrl+Shift+L", openLocalGraph: "Ctrl+Shift+G" };
  for (const hint of bindingHints) {
    const binding = hint.dataset.binding;
    hint.textContent = binding === undefined ? "" : bindings[binding] ?? "";
  }
}

/**
 * The inspector follows the reader's choice, which is a setting rather than panel state: a
 * column deliberately closed should stay closed when the next note opens.
 *
 * Width is the one thing that can override it. A pane too narrow to hold both the note and a
 * 300px column beside it cannot honour the preference, so it closes the column and says so
 * through the toggle, rather than leaving the control claiming a column that is not there.
 */
function watchInspectorWidth(): void {
  roomyPane.addEventListener("change", applyInspectorVisibility);
  applyInspectorVisibility();
}

function applyInspectorVisibility(): void {
  const open = inspectorPreference && roomyPane.matches;
  editorBody.classList.toggle("is-inspector-closed", !open);
  inspectorToggle.setAttribute("aria-expanded", String(open));
  inspectorToggle.disabled = !roomyPane.matches;
  inspectorToggle.title = inspectorToggle.disabled
    ? "The inspector needs a wider editor pane"
    : open
      ? "Hide the note inspector"
      : "Show the note inspector";
}

function toggleInspector(): void {
  if (!roomyPane.matches) return;
  inspectorPreference = !inspectorPreference;
  applyInspectorVisibility();
  api.postMessage({ type: "editor/setInspectorVisible", showInspector: inspectorPreference });
}

function setBrokenLinkCount(count: number): void {
  brokenLinkHint.textContent = count > 0 ? String(count) : "";
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
  for (const segment of widthSegments) {
    const active = segment.dataset.width === contentWidth;
    segment.classList.toggle("is-active", active);
    segment.setAttribute("aria-pressed", String(active));
  }
  // Cached so a reloaded panel paints at the right measure before the host replies.
  api.setState(stateWithEditorContentWidth(api.getState(), contentWidth));
}

/**
 * Redraws the header's index-derived parts, and reports whether they moved.
 *
 * The context is rebuilt by the host on every publish, including one per keystroke, but it is
 * derived purely from the index and so is byte-identical between index commits. Comparing it
 * is far cheaper than rebuilding every tag chip and every backlink row for the same answer.
 */
function renderNoteContext(context: NoteContextWire | undefined): boolean {
  const json = JSON.stringify(context);
  if (json === noteContextJson) return false;
  noteContext = context;
  noteContextJson = json;
  if (context === undefined) {
    breadcrumb.replaceChildren();
    noteTags.replaceChildren();
    noteTagsSummary.hidden = true;
    inspectorCount.textContent = "0";
    return true;
  }

  // Folders only. The file name is the note's title, which the row already states.
  const crumbs: Node[] = [];
  for (const [position, folder] of context.folders.entries()) {
    if (position > 0) crumbs.push(contextSpan("crumb-separator", "/"));
    crumbs.push(contextSpan("crumb", folder));
  }
  breadcrumb.replaceChildren(...crumbs);

  const editable = new Set(context.frontmatterTags.map((tag) => tag.toLocaleLowerCase()));
  noteTags.replaceChildren(
    ...context.tags.map((tag) => tagChip(tag, editable.has(tag.toLocaleLowerCase()))),
    addTagChip(),
  );
  renderTagSummary(context.tags);
  inspectorCount.textContent = String(context.backlinkCount);
  applyInspectorVisibility();
  return true;
}

/** The collapsed form of the tag row: one pill, a dot per tag, up to three. */
function renderTagSummary(tags: readonly string[]): void {
  noteTagsSummary.hidden = tags.length === 0;
  if (tags.length === 0) return;
  const dots = document.createElement("span");
  dots.className = "tag-dots";
  for (const tag of tags.slice(0, 3)) {
    const dot = document.createElement("span");
    dot.className = "tag-dot";
    dot.style.setProperty("--tag-hue", tagHueColor(tag));
    dots.append(dot);
  }
  noteTagsSummary.replaceChildren(
    dots,
    document.createTextNode(`${tags.length} tag${tags.length === 1 ? "" : "s"}`),
  );
  noteTagsSummary.title = tags.map((tag) => `#${tag}`).join(", ");
}

/**
 * Frontmatter tags get a remove control; an inline `#tag` does not, because removing it
 * would mean rewriting the author's sentence. The tooltip says which kind it is.
 */
function tagChip(tag: string, editable: boolean): HTMLElement {
  const chip = document.createElement("span");
  chip.className = editable ? "note-tag is-editable" : "note-tag is-inline";
  const dot = document.createElement("span");
  dot.className = "tag-dot";
  dot.style.setProperty("--tag-hue", tagHueColor(tag));
  // The name is wrapped so it can carry the ellipsis when the toolbar squeezes the tag row.
  // A bare text node becomes an anonymous flex item, which text-overflow has no hold on.
  const label = document.createElement("span");
  label.className = "note-tag-label";
  label.textContent = tag;
  chip.append(dot, label);
  if (!editable) {
    chip.title = `#${tag} is written in the note body`;
    return chip;
  }
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
  button.className = "note-tag-add";
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

function renderInspector(sections: NoteInspectorSections = "all"): void {
  renderNoteInspector(inspector, editor?.source ?? "", noteContext, {
    reveal: (offset) => editor?.reveal(offset),
    openBacklink: (uri, start) => api.postMessage({ type: "editor/openBacklink", uri, start }),
    toggleTask: (task) => {
      setNotice(errorNotice);
      const result = editor?.applyMetadataEdit((source) => planTaskToggle(source, task));
      if (result?.applied === false) {
        setNotice(
          errorNotice,
          result.reason ?? "That task has moved since the list was drawn. It has been redrawn.",
        );
        renderInspector();
      }
    },
    openLink: (target) => api.postMessage({ type: "editor/openLink", target }),
  }, sections);
}

function revealOffset(offset: number): void {
  if (editor === undefined) {
    pendingReveal = offset;
  } else {
    editor.reveal(offset);
  }
}

/**
 * A note gains a backlink when some *other* note is edited, and this is the only message its
 * editor receives when that happens — so the header and the inspector are redrawn here too,
 * not only when this note's own text changes.
 */
function updateIndexState(
  nextSuggestions: readonly NoteSuggestionWire[],
  nextUnresolvedLinks: readonly string[],
  brokenLinkCount: unknown,
  context: unknown,
): void {
  suggestions = nextSuggestions;
  if (typeof brokenLinkCount === "number" && Number.isFinite(brokenLinkCount)) {
    setBrokenLinkCount(brokenLinkCount);
  }
  if (isNoteContext(context)) {
    renderNoteContext(context);
    renderInspector();
  }
  updateUnresolvedLinks(nextUnresolvedLinks);
}

function updateUnresolvedLinks(nextUnresolvedLinks: readonly string[]): void {
  unresolvedLinks = new Set(nextUnresolvedLinks);
  editor?.refreshPreview();
}

/**
 * The note changed on disk while a draft was being typed. Nothing is lost either way, so the
 * three ways out are offered in the order they are wanted: keep what was typed, take what is
 * on disk, or look at the difference first.
 */
function showConflict(): void {
  const conflict = sync.snapshot.conflict;
  if (conflict === undefined) return;
  editor?.setReadOnly(true);
  const copy = document.createElement("span");
  copy.className = "draft-conflict-copy";
  copy.textContent =
    "This note changed on disk while you were typing. Your draft is kept until you choose.";
  const keepDraft = conflictButton("Keep my draft", "is-primary", () => {
    runActions(sync.keepLocal());
    hideConflict();
  });
  const useFile = conflictButton("Use the file", "is-secondary", () => {
    api.postMessage({ type: "editor/discardDraft", version: conflict.version });
    runActions(sync.useExternal());
    hideConflict();
  });
  const compare = conflictButton("Compare", "is-ghost", () => {
    api.postMessage({ type: "editor/compareDraft", source: sync.snapshot.localSource });
  });
  conflictNotice.replaceChildren(codicon("warning"), copy, keepDraft, useFile, compare);
  conflictNotice.hidden = false;
}

function conflictButton(
  label: string,
  variant: string,
  action: () => void,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = variant;
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
    ? { state: undefined, text: "Loading…", hint: "Waiting for the document" }
    : conflict
      ? { state: "conflict", text: "Conflict", hint: "Your draft is kept until you choose" }
      : snapshot.failed
        ? { state: "error", text: "Not synced", hint: "Select to retry the change" }
        : saving
          ? { state: "syncing", text: "Saving", hint: "Writing to disk" }
          : applying
            ? { state: "syncing", text: "Syncing", hint: "Applying your edit" }
            : baseline?.dirty === true
              ? { state: "unsaved", text: "Unsaved", hint: "Select to save · Ctrl/Cmd+S" }
              : { state: "saved", text: "Saved", hint: "Ctrl/Cmd+S saves" };

  syncStatusText.textContent = presentation.text;
  if (presentation.state === undefined) {
    delete syncStatus.dataset.state;
  } else {
    syncStatus.dataset.state = presentation.state;
  }
  syncStatus.title = baseline === undefined
    ? presentation.hint
    : `${presentation.text} — ${presentation.hint} · document version ${baseline.version}`;

  updateMenuAvailability();
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
