import type { GraphNodeWire } from "../contracts.js";

export interface GraphFocusAction {
  readonly label: string;
  readonly disabled: boolean;
  readonly title: string;
}

/**
 * The "Focus here" button beside "Open note", for the selected node.
 *
 * Only a note can be the centre of a graph — the projection is built by walking links out
 * from one note — so a tag or an unresolved name has nothing to draw around, and a task is
 * focused through the note it was written in, the same way it is opened. The node already
 * at the centre is offered nothing: re-centring on the centre redraws the identical graph,
 * and a button that appears to work and changes nothing is worse than one that says why.
 */
export function graphFocusAction(
  node: GraphNodeWire | undefined,
  focusId: string | undefined,
): GraphFocusAction {
  const label = node?.kind === "task" ? "Focus its note" : "Focus here";
  if (node === undefined) {
    return { label, disabled: true, title: "Select a node to draw the graph around it" };
  }
  if (node.uri === undefined) {
    return {
      label,
      disabled: true,
      title: `${node.label} is not a note, so there is no graph to draw around it`,
    };
  }
  if (node.id === focusId) {
    return { label, disabled: true, title: `${node.label} is already the centre of this graph` };
  }
  return { label, disabled: false, title: `Draw the graph around ${node.label}` };
}
