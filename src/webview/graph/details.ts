import type { GraphDataWire, GraphNodeWire } from "../contracts.js";
import { codicon, emptyState, htmlElement } from "../shared/dom.js";
import { connectionsFor } from "./interactionModel.js";
import type { GraphConnection } from "./interactionModel.js";

export interface GraphDetailsElements {
  readonly title: HTMLHeadingElement;
  readonly kind: HTMLElement;
  readonly outgoing: HTMLElement;
  readonly incoming: HTMLElement;
  readonly neighbors: HTMLElement;
  readonly connectionCount: HTMLElement;
  readonly connectionList: HTMLElement;
  readonly openButton: HTMLButtonElement;
}

export function renderGraphDetails(
  elements: GraphDetailsElements,
  graph: GraphDataWire,
  selectedId: string | undefined,
): void {
  const node = findNode(graph, selectedId);
  if (node === undefined) {
    renderEmptyDetails(elements);
    return;
  }
  const connections = connectionsFor(graph, node.id);
  const outgoing = graph.edges.filter(
    (edge) => edge.kind === "link" && edge.source === node.id && edge.target !== node.id,
  ).length;
  const incoming = graph.edges.filter(
    (edge) => edge.kind === "link" && edge.target === node.id && edge.source !== node.id,
  ).length;
  elements.title.textContent = node.label;
  elements.kind.textContent = `${capitalize(node.kind)}${node.orphan === true ? " · orphan" : ""}`;
  elements.outgoing.textContent = String(outgoing);
  elements.incoming.textContent = String(incoming);
  elements.neighbors.textContent = String(connections.length);
  elements.connectionCount.textContent = String(connections.length);
  elements.connectionList.replaceChildren(...connectionRows(connections));
  elements.openButton.disabled = node.uri === undefined;
  elements.openButton.textContent = node.kind === "task" ? "Open source note" : "Open note";
}

function renderEmptyDetails(elements: GraphDetailsElements): void {
  elements.title.textContent = "Select a node";
  elements.kind.textContent = "Use arrow keys to move between nodes.";
  elements.outgoing.textContent = "0";
  elements.incoming.textContent = "0";
  elements.neighbors.textContent = "0";
  elements.connectionCount.textContent = "0";
  elements.connectionList.replaceChildren(emptyConnections());
  elements.openButton.disabled = true;
  elements.openButton.textContent = "Open note";
}

function connectionRows(connections: readonly GraphConnection[]): readonly HTMLElement[] {
  if (connections.length === 0) return [emptyConnections()];
  return connections.map((connection) => {
    const button = htmlElement("button", "connection-row");
    button.type = "button";
    button.dataset.nodeId = connection.node.id;
    const relation = connectionRelation(connection);
    button.title = `Select ${connection.node.label} — ${relation.description}`;
    const kinds = connection.edgeKinds.map(capitalize).join(" + ");
    button.append(
      htmlElement("span", `connection-marker marker-${connection.node.kind}`),
      codicon(NODE_ICONS[connection.node.kind]),
      htmlElement("span", "connection-label", connection.node.label),
      htmlElement("span", "connection-relation", kinds),
      codicon(relation.icon, relation.description),
    );
    return button;
  });
}

function emptyConnections(): HTMLElement {
  return emptyState(
    "circle-slash",
    "No visible connections.",
    "Widen the link depth or re-enable a node type to see more.",
  );
}

const NODE_ICONS: Readonly<Record<GraphNodeWire["kind"], string>> = {
  note: "note",
  task: "checklist",
  tag: "tag",
  unresolved: "question",
};

/** Direction reads as an arrow rather than as a text glyph, with the words kept for a11y. */
function connectionRelation(
  connection: GraphConnection,
): { readonly icon: string; readonly description: string } {
  switch (connection.direction) {
    case "both":
      return { icon: "arrow-both", description: "links in both directions" };
    case "outgoing":
      return { icon: "arrow-right", description: "links out" };
    case "incoming":
      return { icon: "arrow-left", description: "links in" };
  }
}

function findNode(graph: GraphDataWire, id: string | undefined): GraphNodeWire | undefined {
  return id === undefined ? undefined : graph.nodes.find((node) => node.id === id);
}

function capitalize(value: string): string {
  return value.charAt(0).toLocaleUpperCase() + value.slice(1);
}
