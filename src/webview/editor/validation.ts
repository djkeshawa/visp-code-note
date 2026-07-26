import { EDITOR_CONTENT_WIDTHS } from "../../application/editorContentWidth.js";
import type { EditorDocumentStateWire, EditorStateWire } from "../contracts.js";
import { isRecord } from "../shared/dom.js";

export function isEditorState(value: unknown): value is EditorStateWire {
  if (!isRecord(value) || !isEditorDocumentState(value)) return false;
  const state: Record<string, unknown> = value;
  return (
    typeof state.uri === "string" &&
    EDITOR_CONTENT_WIDTHS.some((width) => width === state.contentWidth) &&
    (state.recoveredDraft === undefined || (
      isRecord(state.recoveredDraft) &&
      typeof state.recoveredDraft.source === "string" &&
      typeof state.recoveredDraft.saveRequested === "boolean"
    )) &&
    isNoteSuggestions(state.noteSuggestions)
  );
}

export function isEditorDocumentState(value: unknown): value is EditorDocumentStateWire {
  return isRecord(value) &&
    typeof value.source === "string" &&
    typeof value.title === "string" &&
    isOffset(value.version) &&
    (value.acknowledgedSequence === undefined || isOffset(value.acknowledgedSequence)) &&
    typeof value.dirty === "boolean" &&
    isUnresolvedLinks(value.unresolvedLinks) &&
    (value.context === undefined || isNoteContext(value.context));
}

function isNoteContext(value: unknown): boolean {
  return (
    isRecord(value) &&
    isStringArray(value.folders) &&
    typeof value.fileName === "string" &&
    isStringArray(value.tags) &&
    isStringArray(value.frontmatterTags) &&
    isOffset(value.backlinkCount) &&
    isOffset(value.outgoingCount) &&
    isOffset(value.taskCount) &&
    isOffset(value.openTaskCount)
  );
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

export function isNoteSuggestions(value: unknown): value is EditorStateWire["noteSuggestions"] {
  return Array.isArray(value) && value.every(isNoteSuggestion);
}

export function isUnresolvedLinks(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((link) => typeof link === "string");
}

function isNoteSuggestion(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.label === "string" &&
    typeof value.target === "string" &&
    typeof value.path === "string" &&
    Array.isArray(value.aliases) &&
    value.aliases.every((alias) => typeof alias === "string") &&
    typeof value.referenceTarget === "string" &&
    Array.isArray(value.headings) &&
    value.headings.every((heading) => typeof heading === "string") &&
    Array.isArray(value.blockIds) &&
    value.blockIds.every((blockId) => typeof blockId === "string")
  );
}

function isOffset(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
