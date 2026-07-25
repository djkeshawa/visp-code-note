import type {
  GraphDataWire,
  GraphEdgeWire,
  GraphNodeKindWire,
  GraphNodeWire,
} from "../contracts.js";

export interface GraphConnection {
  readonly node: GraphNodeWire;
  readonly direction: "incoming" | "outgoing" | "both";
  readonly edgeKinds: readonly GraphEdgeWire["kind"][];
}

export function filterGraph(
  graph: GraphDataWire,
  kinds: ReadonlySet<GraphNodeKindWire>,
  includeOrphans: boolean,
): GraphDataWire {
  const nodes = graph.nodes.filter(
    (node) => kinds.has(node.kind) && (includeOrphans || node.orphan !== true),
  );
  const nodeIds = new Set(nodes.map((node) => node.id));
  return {
    nodes,
    edges: graph.edges.filter(
      (edge) => edge.source !== edge.target && nodeIds.has(edge.source) && nodeIds.has(edge.target),
    ),
    focusId: graph.focusId !== undefined && nodeIds.has(graph.focusId) ? graph.focusId : undefined,
  };
}

export function resolveSelection(
  graph: GraphDataWire,
  currentId: string | undefined,
): string | undefined {
  if (currentId !== undefined && graph.nodes.some((node) => node.id === currentId)) {
    return currentId;
  }
  return graph.focusId;
}

export function findMatchingNodeIds(graph: GraphDataWire, query: string): readonly string[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (normalized.length === 0) return [];
  return graph.nodes
    .filter((node) => node.label.toLocaleLowerCase().includes(normalized))
    .map((node) => node.id);
}

export function cycleNodeId(
  nodeIds: readonly string[],
  currentId: string | undefined,
  direction: 1 | -1,
): string | undefined {
  if (nodeIds.length === 0) return undefined;
  const currentIndex = currentId === undefined ? -1 : nodeIds.indexOf(currentId);
  if (currentIndex === -1) return direction === 1 ? nodeIds[0] : nodeIds[nodeIds.length - 1];
  return nodeIds[(currentIndex + direction + nodeIds.length) % nodeIds.length];
}

export function keyboardNodeId(
  nodeIds: readonly string[],
  key: string,
): string | undefined {
  switch (key) {
    case "Home":
      return nodeIds[0];
    case "End":
      return nodeIds[nodeIds.length - 1];
    default:
      return undefined;
  }
}

export function connectionsFor(graph: GraphDataWire, selectedId: string): readonly GraphConnection[] {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const connections = new Map<string, MutableConnection>();
  for (const edge of graph.edges) {
    if (edge.source !== selectedId && edge.target !== selectedId) continue;
    if (edge.source === edge.target) continue;
    const outgoing = edge.source === selectedId;
    const nodeId = outgoing ? edge.target : edge.source;
    const node = nodesById.get(nodeId);
    if (node === undefined) continue;
    const connection = connections.get(nodeId) ?? {
      node,
      incoming: false,
      outgoing: false,
      edgeKinds: new Set<GraphEdgeWire["kind"]>(),
    };
    connection.incoming ||= !outgoing;
    connection.outgoing ||= outgoing;
    connection.edgeKinds.add(edge.kind);
    connections.set(nodeId, connection);
  }
  return [...connections.values()]
    .sort(compareConnections)
    .map((connection) => ({
      node: connection.node,
      direction: connection.incoming && connection.outgoing
        ? "both"
        : connection.outgoing ? "outgoing" : "incoming",
      edgeKinds: [...connection.edgeKinds].sort(compareEdgeKinds),
    }));
}

interface MutableConnection {
  readonly node: GraphNodeWire;
  incoming: boolean;
  outgoing: boolean;
  readonly edgeKinds: Set<GraphEdgeWire["kind"]>;
}

function compareConnections(left: MutableConnection, right: MutableConnection): number {
  return nodeKindOrder(left.node.kind) - nodeKindOrder(right.node.kind)
    || left.node.label.localeCompare(right.node.label);
}

function nodeKindOrder(kind: GraphNodeKindWire): number {
  return ["note", "task", "tag", "unresolved"].indexOf(kind);
}

function compareEdgeKinds(left: GraphEdgeWire["kind"], right: GraphEdgeWire["kind"]): number {
  return ["link", "task", "tag"].indexOf(left) - ["link", "task", "tag"].indexOf(right);
}
