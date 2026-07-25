import type {
  BacklinksToHostMessage,
  EditorToHostMessage,
  GraphToHostMessage,
  TasksToHostMessage,
} from "../../domain/protocol";

export function isEditorMessage(value: unknown): value is EditorToHostMessage {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  switch (value.type) {
    case "editor/ready":
    case "editor/save":
    case "editor/requestLink":
      return true;
    case "editor/discardDraft":
      return isOffset(value.version);
    case "editor/stashDraft":
      return isSource(value.source) && typeof value.saveRequested === "boolean";
    case "editor/openLink":
      return isShortString(value.target) && !/[\r\n]/.test(value.target)
        && (value.beside === undefined || typeof value.beside === "boolean");
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
  return value.type === "graph/depth" && (value.depth === 1 || value.depth === 2);
}

export function isBacklinksMessage(value: unknown): value is BacklinksToHostMessage {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  if (value.type === "backlinks/ready") return true;
  return value.type === "backlinks/open" && isSource(value.uri) && isOffset(value.start);
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
