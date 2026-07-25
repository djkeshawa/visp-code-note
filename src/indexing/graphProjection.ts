import type { GraphData, GraphEdge, GraphNode, IndexSnapshot } from "../domain/models";
import { normalizeNoteKey } from "../domain/normalization";

export interface GraphOptions {
  readonly includeTasks?: boolean;
  readonly includeTags?: boolean;
  readonly includeUnresolved?: boolean;
  readonly includeOrphans?: boolean;
}

export function buildWorkspaceGraph(
  snapshot: IndexSnapshot,
  options: GraphOptions = {},
): GraphData {
  return buildGraph(snapshot, new Set(snapshot.notes.map((note) => note.uri)), options);
}

export function buildLocalGraph(
  snapshot: IndexSnapshot,
  focusUri: string,
  depth: 1 | 2,
  options: GraphOptions = {},
): GraphData {
  if (!snapshot.notes.some((note) => note.uri === focusUri)) {
    return Object.freeze({ nodes: Object.freeze([]), edges: Object.freeze([]) });
  }

  const adjacency = linkAdjacency(snapshot);
  const selected = new Set([focusUri]);
  let frontier = new Set([focusUri]);
  for (let hop = 0; hop < depth; hop += 1) {
    const next = new Set<string>();
    for (const uri of frontier) {
      for (const neighbor of adjacency.get(uri) ?? []) {
        if (!selected.has(neighbor)) {
          selected.add(neighbor);
          next.add(neighbor);
        }
      }
    }
    frontier = next;
  }
  return buildGraph(snapshot, selected, options, focusUri);
}

function buildGraph(
  snapshot: IndexSnapshot,
  selectedUris: ReadonlySet<string>,
  options: GraphOptions,
  focusUri?: string,
): GraphData {
  const includeTasks = options.includeTasks ?? true;
  const includeTags = options.includeTags ?? true;
  const includeUnresolved = options.includeUnresolved ?? true;
  const connected = connectedNoteUris(snapshot);
  const visibleUris = new Set(
    [...selectedUris].filter(
      (uri) => options.includeOrphans !== false || connected.has(uri) || uri === focusUri,
    ),
  );
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();

  for (const note of snapshot.notes) {
    if (!visibleUris.has(note.uri)) continue;
    addNode(nodes, {
      id: noteNodeId(note.uri),
      label: note.title,
      kind: "note",
      uri: note.uri,
      orphan: !connected.has(note.uri),
    });
    if (includeTags) {
      for (const tag of note.tags) addTag(nodes, edges, noteNodeId(note.uri), tag);
    }
  }

  for (const resolved of snapshot.links) {
    if (!visibleUris.has(resolved.sourceUri)) continue;
    const sourceId = noteNodeId(resolved.sourceUri);
    if (resolved.targetUri !== undefined && visibleUris.has(resolved.targetUri)) {
      addEdge(edges, sourceId, noteNodeId(resolved.targetUri), "link");
    } else if (resolved.targetUri === undefined && includeUnresolved) {
      const targetId = unresolvedNodeId(resolved.link.target);
      addNode(nodes, {
        id: targetId,
        label: resolved.link.target || "Unresolved link",
        kind: "unresolved",
      });
      addEdge(edges, sourceId, targetId, "link");
    }
  }

  if (includeTasks) addTaskNodes(snapshot, visibleUris, nodes, edges, includeTags);
  return freezeGraph(nodes, edges, focusUri);
}

function addTaskNodes(
  snapshot: IndexSnapshot,
  visibleUris: ReadonlySet<string>,
  nodes: Map<string, GraphNode>,
  edges: Map<string, GraphEdge>,
  includeTags: boolean,
): void {
  for (const task of snapshot.tasks) {
    if (!visibleUris.has(task.noteUri)) continue;
    const id = taskNodeId(task.noteUri, task.id, task.range.start);
    addNode(nodes, { id, label: task.text || "Untitled task", kind: "task", uri: task.noteUri });
    addEdge(edges, noteNodeId(task.noteUri), id, "task");
    if (includeTags) {
      for (const tag of task.tags) addTag(nodes, edges, id, tag);
    }
  }
}

function freezeGraph(
  nodes: ReadonlyMap<string, GraphNode>,
  edges: ReadonlyMap<string, GraphEdge>,
  focusUri?: string,
): GraphData {
  const orderedNodes = Object.freeze(
    [...nodes.values()].sort(
      (left, right) =>
        graphKindOrder(left.kind) - graphKindOrder(right.kind) ||
        compareText(left.label, right.label) ||
        compareText(left.id, right.id),
    ),
  );
  const orderedEdges = Object.freeze([...edges.values()].sort((left, right) => compareText(left.id, right.id)));
  return Object.freeze({
    nodes: orderedNodes,
    edges: orderedEdges,
    ...(focusUri === undefined ? {} : { focusId: noteNodeId(focusUri) }),
  });
}

function connectedNoteUris(snapshot: IndexSnapshot): Set<string> {
  const connected = new Set<string>();
  for (const link of snapshot.links) {
    if (link.targetUri !== undefined) {
      connected.add(link.sourceUri);
      connected.add(link.targetUri);
    }
  }
  return connected;
}

function linkAdjacency(snapshot: IndexSnapshot): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>();
  for (const link of snapshot.links) {
    if (link.targetUri === undefined) continue;
    addNeighbor(adjacency, link.sourceUri, link.targetUri);
    addNeighbor(adjacency, link.targetUri, link.sourceUri);
  }
  return adjacency;
}

function addNeighbor(adjacency: Map<string, Set<string>>, source: string, target: string): void {
  const neighbors = adjacency.get(source) ?? new Set<string>();
  neighbors.add(target);
  adjacency.set(source, neighbors);
}

function addTag(
  nodes: Map<string, GraphNode>,
  edges: Map<string, GraphEdge>,
  sourceId: string,
  tag: string,
): void {
  const id = tagNodeId(tag);
  addNode(nodes, { id, label: `#${tag}`, kind: "tag" });
  addEdge(edges, sourceId, id, "tag");
}

function addNode(nodes: Map<string, GraphNode>, node: GraphNode): void {
  if (!nodes.has(node.id)) nodes.set(node.id, Object.freeze(node));
}

function addEdge(
  edges: Map<string, GraphEdge>,
  source: string,
  target: string,
  kind: GraphEdge["kind"],
): void {
  const id = `${kind}:${source}->${target}`;
  if (!edges.has(id)) edges.set(id, Object.freeze({ id, source, target, kind }));
}

function noteNodeId(uri: string): string {
  return `note:${uri}`;
}

function taskNodeId(uri: string, id: string | undefined, start: number): string {
  return `task:${uri}:${id ?? "anonymous"}:${start}`;
}

function tagNodeId(tag: string): string {
  return `tag:${safeKey(tag)}`;
}

function unresolvedNodeId(target: string): string {
  return `unresolved:${safeKey(target)}`;
}

function safeKey(value: string): string {
  try {
    return normalizeNoteKey(value);
  } catch {
    return value.trim().toLocaleLowerCase();
  }
}

function graphKindOrder(kind: GraphNode["kind"]): number {
  return ["note", "task", "tag", "unresolved"].indexOf(kind);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
