import type { GraphDataWire, GraphNodeWire } from "../contracts.js";
import { svgElement } from "../shared/dom.js";
import { positionsWithOverrides } from "./dragModel.js";
import { graphLayoutBounds, layoutGraph } from "./layout.js";
import type { GraphPoint } from "./layout.js";
import {
  isHubNode,
  nodeDegrees,
  nodeHitRadius,
  nodeRadius,
  standingLabelIds,
} from "./metrics.js";
import type { GraphExtent } from "./viewportModel.js";

export interface RenderedGraph {
  readonly positions: ReadonlyMap<string, GraphPoint>;
  readonly extent?: GraphExtent;
}

export function renderGraphSvg(
  svg: SVGSVGElement,
  graph: GraphDataWire,
  selectedId: string | undefined,
  positionOverrides: ReadonlyMap<string, GraphPoint> = new Map(),
): RenderedGraph {
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const bounds = graphLayoutBounds(graph.nodes.length);
  const positions = positionsWithOverrides(layoutGraph(graph, bounds), nodeIds, positionOverrides);
  const midX = bounds.width / 2;
  const degrees = nodeDegrees(graph);
  const labelledIds = standingLabelIds(graph, degrees);
  const tabStopId = selectedId ?? graph.focusId ?? graph.nodes[0]?.id;
  const edgeLayer = svgElement("g", { class: "edge-layer" });
  for (const edge of graph.edges) {
    if (edge.source === edge.target) continue;
    const source = positions.get(edge.source);
    const target = positions.get(edge.target);
    if (source === undefined || target === undefined) {
      continue;
    }
    edgeLayer.append(
      svgElement("line", {
        class: `graph-edge edge-${edge.kind}`,
        "data-source-id": edge.source,
        "data-target-id": edge.target,
        x1: String(source.x),
        y1: String(source.y),
        x2: String(target.x),
        y2: String(target.y),
      }),
    );
  }

  const nodeLayer = svgElement("g", { class: "node-layer" });
  for (const node of graph.nodes) {
    const point = positions.get(node.id);
    if (point !== undefined) {
      nodeLayer.append(createNode(
        node,
        point,
        degrees.get(node.id) ?? 0,
        graph.focusId === node.id,
        selectedId === node.id,
        tabStopId === node.id,
        labelledIds.has(node.id),
        midX,
      ));
    }
  }
  svg.replaceChildren(edgeLayer, nodeLayer);
  return { positions, extent: graphExtentForPositions(positions) };
}

function createNode(
  node: GraphNodeWire,
  point: GraphPoint,
  degree: number,
  focused: boolean,
  selected: boolean,
  tabbable: boolean,
  labelled: boolean,
  midX: number,
): SVGGElement {
  const classNames = ["graph-node", `node-${node.kind}`];
  if (isHubNode(degree)) {
    classNames.push("is-hub");
  }
  if (node.orphan === true) {
    classNames.push("is-orphan");
  }
  if (focused) {
    classNames.push("is-focus");
  }
  if (selected) {
    classNames.push("is-selected");
  }
  // Focus and selection always keep their label, however crowded the canvas.
  if (labelled || focused || selected) {
    classNames.push("has-standing-label");
  }
  const group = svgElement("g", {
    class: classNames.join(" "),
    transform: `translate(${point.x} ${point.y})`,
    tabindex: tabbable ? "0" : "-1",
    role: "button",
    "aria-label": nodeDescription(node, degree),
  });
  if (selected) group.setAttribute("aria-current", "true");
  group.dataset.nodeId = node.id;
  group.append(svgElement("title"));
  const title = group.firstElementChild;
  if (title !== null) {
    title.textContent = node.label;
  }
  const radius = nodeRadius(node, degree, focused);
  group.dataset.labelOffset = String(radius + 6);
  group.append(svgElement("circle", {
    class: "node-hit-area",
    cx: "0",
    cy: "0",
    r: String(nodeHitRadius(radius)),
  }));
  group.append(createShape(node, radius));

  const labelOnLeft = point.x > midX;
  const label = svgElement("text", {
    class: "node-label",
    x: String((radius + 6) * (labelOnLeft ? -1 : 1)),
    y: "4",
    "text-anchor": labelOnLeft ? "end" : "start",
  });
  label.textContent = truncateLabel(node.label);
  group.append(label);
  return group;
}

function createShape(node: GraphNodeWire, radius: number): SVGElement {
  if (node.kind === "task") {
    const halfSize = radius * 0.72;
    return svgElement("rect", {
      class: "node-shape",
      x: String(-halfSize),
      y: String(-halfSize),
      width: String(halfSize * 2),
      height: String(halfSize * 2),
      rx: "1.5",
      transform: "rotate(45)",
    });
  }
  return svgElement("circle", { class: "node-shape", cx: "0", cy: "0", r: String(radius) });
}

function nodeDescription(node: GraphNodeWire, degree: number): string {
  const connectionLabel = `${degree} visible connection${degree === 1 ? "" : "s"}`;
  return `${node.label}, ${node.kind}, ${connectionLabel}${node.orphan === true ? ", orphan" : ""}`;
}

function truncateLabel(label: string): string {
  return label.length > 24 ? `${label.slice(0, 23)}…` : label;
}

export function graphExtentForPositions(
  positions: ReadonlyMap<string, GraphPoint>,
): GraphExtent | undefined {
  if (positions.size === 0) return undefined;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of positions.values()) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return {
    minX: minX - 130,
    minY: minY - 54,
    maxX: maxX + 130,
    maxY: maxY + 54,
  };
}
