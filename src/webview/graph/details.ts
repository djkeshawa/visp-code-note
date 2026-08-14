import type { GraphDataWire, GraphNodeWire } from "../contracts.js";
import { codicon, htmlElement } from "../shared/dom.js";
import { tagHueColor } from "../../application/tagHue.js";
import { connectionsFor } from "./interactionModel.js";
import type { GraphConnection } from "./interactionModel.js";
import { graphFocusAction } from "./focusAction.js";
import type { GraphFocusAction } from "./focusAction.js";

/**
 * The card for the selected node. It reports the node's degree, lists what it touches with
 * the direction of each link, and offers the one action worth a button — opening it.
 *
 * With nothing selected the card is not empty, it is absent: an empty card in the corner of
 * the canvas is a hole in the drawing that says nothing.
 */
export interface GraphDetailsElements {
  readonly card: HTMLElement;
  readonly dot: HTMLElement;
  readonly title: HTMLHeadingElement;
  readonly outgoing: HTMLElement;
  readonly incoming: HTMLElement;
  readonly neighbors: HTMLElement;
  readonly connectionCount: HTMLElement;
  readonly connectionList: HTMLElement;
  readonly closeButton: HTMLButtonElement;
  readonly openButton: HTMLButtonElement;
  readonly focusButton: HTMLButtonElement;
}

export function renderGraphDetails(
  elements: GraphDetailsElements,
  graph: GraphDataWire,
  selectedId: string | undefined,
): void {
  const node = findNode(graph, selectedId);
  applyFocusAction(elements.focusButton, graphFocusAction(node, graph.focusId));
  if (node === undefined) {
    elements.card.hidden = true;
    elements.connectionList.replaceChildren();
    elements.connectionCount.textContent = "0";
    elements.openButton.disabled = true;
    return;
  }
  const connections = connectionsFor(graph, node.id);
  const outgoing = graph.edges.filter(
    (edge) => edge.kind === "link" && edge.source === node.id && edge.target !== node.id,
  ).length;
  const incoming = graph.edges.filter(
    (edge) => edge.kind === "link" && edge.target === node.id && edge.source !== node.id,
  ).length;
  elements.card.hidden = false;
  elements.dot.className = `graph-details-dot is-${node.kind}`;
  elements.dot.title = `${capitalize(node.kind)}${node.orphan === true ? " · orphan" : ""}`;
  elements.title.textContent = node.label;
  elements.title.title = `${node.label} — ${elements.dot.title}`;
  elements.outgoing.textContent = String(outgoing);
  elements.incoming.textContent = String(incoming);
  elements.neighbors.textContent = String(connections.length);
  elements.connectionCount.textContent = String(connections.length);
  elements.connectionList.replaceChildren(...connectionRows(connections));
  elements.openButton.disabled = node.uri === undefined;
  elements.openButton.textContent = node.kind === "task" ? "Open source note" : "Open note";
}

function applyFocusAction(button: HTMLButtonElement, action: GraphFocusAction): void {
  button.textContent = action.label;
  button.disabled = action.disabled;
  button.title = action.title;
}

function connectionRows(connections: readonly GraphConnection[]): readonly HTMLElement[] {
  if (connections.length === 0) {
    return [htmlElement("p", "connection-empty", "Nothing else links here yet.")];
  }
  return connections.map((connection) => {
    const button = htmlElement("button", "connection-row");
    button.type = "button";
    button.dataset.nodeId = connection.node.id;
    const relation = connectionRelation(connection);
    const kinds = connection.edgeKinds.map(capitalize).join(" + ");
    button.title = `Select ${connection.node.label} — ${kinds}, ${relation.description}`;
    const marker = htmlElement("span", `connection-marker marker-${connection.node.kind}`);
    if (connection.node.kind === "tag") {
      marker.style.setProperty("--tag-hue", tagHueColor(connection.node.label));
    }
    button.append(
      marker,
      htmlElement("span", "connection-label", connection.node.label),
      codicon(relation.icon, relation.description),
    );
    return button;
  });
}

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
