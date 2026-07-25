import type { GraphDataWire, GraphNodeKindWire } from "../contracts.js";
import { isRecord } from "../shared/dom.js";

export function isGraphData(value: unknown): value is GraphDataWire {
  return (
    isRecord(value) &&
    Array.isArray(value.nodes) &&
    value.nodes.every(
      (node) =>
        isRecord(node) &&
        typeof node.id === "string" &&
        typeof node.label === "string" &&
        isGraphNodeKind(node.kind) &&
        (node.uri === undefined || typeof node.uri === "string") &&
        (node.orphan === undefined || typeof node.orphan === "boolean"),
    ) &&
    Array.isArray(value.edges) &&
    value.edges.every(
      (edge) =>
        isRecord(edge) &&
        typeof edge.id === "string" &&
        typeof edge.source === "string" &&
        typeof edge.target === "string" &&
        (edge.kind === "link" || edge.kind === "task" || edge.kind === "tag"),
    ) &&
    (value.focusId === undefined || typeof value.focusId === "string")
  );
}

export function isGraphDepth(value: unknown): value is 1 | 2 {
  return value === 1 || value === 2;
}

function isGraphNodeKind(value: unknown): value is GraphNodeKindWire {
  return value === "note" || value === "task" || value === "tag" || value === "unresolved";
}
