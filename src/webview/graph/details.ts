import type { GraphDataWire, GraphNodeKindWire, GraphNodeWire } from "../contracts.js";
import { htmlElement } from "../shared/dom.js";
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
    button.title = `Select ${connection.node.label}`;
    button.append(
      htmlElement("span", `connection-marker marker-${connection.node.kind}`),
      htmlElement("span", "connection-label", connection.node.label),
      htmlElement("span", "connection-relation", connectionRelation(connection)),
    );
    return button;
  });
}

function emptyConnections(): HTMLElement {
  return htmlElement("p", "connection-empty muted", "No visible connections.");
}

function connectionRelation(connection: GraphConnection): string {
  const kind = connection.edgeKinds.map(capitalize).join(" + ");
  const direction = connection.direction === "both"
    ? "↔"
    : connection.direction === "outgoing" ? "out →" : "in ←";
  return `${kind} · ${direction}`;
}

function findNode(graph: GraphDataWire, id: string | undefined): GraphNodeWire | undefined {
  return id === undefined ? undefined : graph.nodes.find((node) => node.id === id);
}

function capitalize(value: string | GraphNodeKindWire): string {
  return value.charAt(0).toLocaleUpperCase() + value.slice(1);
}
