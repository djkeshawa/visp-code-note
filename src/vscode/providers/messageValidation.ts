import { isExternalLink } from "../../application/externalLink";
import { EDITOR_CONTENT_WIDTHS } from "../../application/editorContentWidth";
import type {
  EditorMenuCommand,
  EditorToHostMessage,
  GraphMenuCommand,
  GraphToHostMessage,
  TasksToHostMessage,
  WorkspaceMenuCommand,
  WorkspaceToHostMessage,
} from "../../domain/protocol";

const GRAPH_MENU_COMMANDS: readonly GraphMenuCommand[] = ["openWorkspaceGraph", "rebuildIndex"];

const WORKSPACE_MENU_COMMANDS: readonly WorkspaceMenuCommand[] = ["search"];

const WORKSPACE_VIEW_IDS = ["tasks", "due", "graph", "broken", "orphans"];

/** The closed set a note row's menu may ask for. `delete` still confirms on the host side. */
const WORKSPACE_NOTE_ACTIONS = ["rename", "graph", "delete"];

/** The closed set the overflow menu may ask for; anything else is not a command here. */
const EDITOR_MENU_COMMANDS: readonly EditorMenuCommand[] = [
  "newTask",
  "renameNote",
  "findBrokenLinks",
  "openLocalGraph",
  "rebuildIndex",
];

export function isEditorMessage(value: unknown): value is EditorToHostMessage {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  switch (value.type) {
    case "editor/ready":
    case "editor/save":
    case "editor/requestLink":
    case "editor/requestTag":
      return true;
    case "editor/discardDraft":
      return isOffset(value.version);
    case "editor/setContentWidth":
      return EDITOR_CONTENT_WIDTHS.some((width) => width === value.contentWidth);
    case "editor/setInspectorVisible":
      return typeof value.showInspector === "boolean";
    case "editor/stashDraft":
      return isSource(value.source) && typeof value.saveRequested === "boolean";
    case "editor/openExternal":
      // Re-checked here because the webview's own filter is a convenience, not the gate.
      return isExternalLink(value.url);
    case "editor/openLink":
      return isShortString(value.target) && !/[\r\n]/.test(value.target)
        && (value.beside === undefined || typeof value.beside === "boolean");
    case "editor/openBacklink":
      return isSource(value.uri) && isOffset(value.start);
    case "editor/runCommand":
      return EDITOR_MENU_COMMANDS.some((command) => command === value.command);
    case "editor/compareDraft":
      return isSource(value.source);
    case "editor/editSource":
      return isOffset(value.start) && isOffset(value.end) && value.end >= value.start
        && isSource(value.source) && isSource(value.expectedSource) && isOffset(value.version)
        && isPositiveInteger(value.sequence)
        && (value.save === undefined || typeof value.save === "boolean");
    default:
      return false;
  }
}

export function isTasksMessage(value: unknown): value is TasksToHostMessage {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  if (value.type === "tasks/ready") return true;
  if (value.type === "tasks/open") {
    return isSource(value.noteUri) && isOffset(value.start);
  }
  if (value.type === "tasks/toggle") {
    return isSource(value.noteUri) && isOffset(value.start)
      && (value.taskId === undefined || isSource(value.taskId))
      && typeof value.completed === "boolean" && isOffset(value.version);
  }
  return false;
}

export function isGraphMessage(value: unknown): value is GraphToHostMessage {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  if (value.type === "graph/ready") return true;
  if (value.type === "graph/open") return isSource(value.uri);
  if (value.type === "graph/runCommand") {
    return GRAPH_MENU_COMMANDS.some((command) => command === value.command);
  }
  return value.type === "graph/depth" && (value.depth === 1 || value.depth === 2);
}

/**
 * The workspace panel is a webview, so everything it sends is untrusted — including the note
 * URIs and task offsets it asks the host to act on.
 */
export function isWorkspaceMessage(value: unknown): value is WorkspaceToHostMessage {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  switch (value.type) {
    case "workspace/ready":
      return true;
    case "workspace/openNote":
      return isSource(value.uri);
    case "workspace/openView":
      return WORKSPACE_VIEW_IDS.some((id) => id === value.id);
    case "workspace/openTag":
      return isShortString(value.tag) && !/[\r\n]/.test(value.tag);
    case "workspace/revealTask":
      return isSource(value.noteUri) && isOffset(value.start);
    case "workspace/toggleTask":
      return isSource(value.noteUri) && isOffset(value.start)
        && (value.taskId === undefined || isSource(value.taskId))
        && typeof value.completed === "boolean" && isOffset(value.version);
    case "workspace/runCommand":
      return WORKSPACE_MENU_COMMANDS.some((command) => command === value.command);
    case "workspace/noteAction":
      return WORKSPACE_NOTE_ACTIONS.some((action) => action === value.action) && isSource(value.uri);
    default:
      return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isOffset(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return isOffset(value) && value > 0;
}

function isShortString(value: unknown): value is string {
  return typeof value === "string" && value.length <= 2_048;
}

function isSource(value: unknown): value is string {
  return typeof value === "string" && value.length <= 10_000_000;
}
