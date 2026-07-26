import type { GraphPoint } from "./layout.js";

interface PositionedNode {
  readonly id: string;
  readonly element: SVGGElement;
  readonly label: SVGTextElement | null;
  readonly labelOffset: number;
  appliedX: number;
  appliedY: number;
  labelOnLeft: boolean;
}

interface PositionedEdge {
  readonly element: SVGLineElement;
  readonly sourceId: string;
  readonly targetId: string;
  appliedX1: number;
  appliedY1: number;
  appliedX2: number;
  appliedY2: number;
}

/**
 * Movement below this many pixels is not visible once coordinates are rounded to two
 * decimals, so writing it back to the DOM only costs layout work. As the simulation cools
 * almost every node falls below the threshold, which is what makes the closing frames of a
 * large graph cheap.
 */
const MOVEMENT_EPSILON = 0.05;

export class GraphPositionUpdater {
  private nodes: readonly PositionedNode[] = [];
  private edges: readonly PositionedEdge[] = [];
  private midX = 480;

  public constructor(private readonly svg: SVGSVGElement) {}

  /** The x coordinate labels flip around; scales with the layout, not a fixed canvas. */
  public setMidX(midX: number): void {
    this.midX = midX;
  }

  public refresh(): void {
    this.nodes = Array.from(this.svg.querySelectorAll<SVGGElement>(".graph-node"))
      .flatMap((element) => {
        const id = element.dataset.nodeId;
        const labelOffset = Number(element.dataset.labelOffset);
        return id === undefined || !Number.isFinite(labelOffset)
          ? []
          : [{
              id,
              element,
              label: element.querySelector<SVGTextElement>(".node-label"),
              labelOffset,
              appliedX: Number.NaN,
              appliedY: Number.NaN,
              labelOnLeft: false,
            }];
      });
    this.edges = Array.from(this.svg.querySelectorAll<SVGLineElement>(".graph-edge"))
      .flatMap((element) => {
        const sourceId = element.dataset.sourceId;
        const targetId = element.dataset.targetId;
        return sourceId === undefined || targetId === undefined
          ? []
          : [{
              element,
              sourceId,
              targetId,
              appliedX1: Number.NaN,
              appliedY1: Number.NaN,
              appliedX2: Number.NaN,
              appliedY2: Number.NaN,
            }];
      });
  }

  public apply(positions: ReadonlyMap<string, GraphPoint>): void {
    for (const node of this.nodes) {
      const point = positions.get(node.id);
      if (point === undefined || !moved(node.appliedX, node.appliedY, point.x, point.y)) {
        continue;
      }
      const placed = Number.isFinite(node.appliedX);
      node.appliedX = point.x;
      node.appliedY = point.y;
      node.element.setAttribute(
        "transform",
        `translate(${coordinate(point.x)} ${coordinate(point.y)})`,
      );
      const onLeft = point.x > this.midX;
      if (onLeft !== node.labelOnLeft || !placed) {
        node.labelOnLeft = onLeft;
        positionLabel(node, onLeft);
      }
    }
    for (const edge of this.edges) {
      const source = positions.get(edge.sourceId);
      const target = positions.get(edge.targetId);
      if (source === undefined || target === undefined) continue;
      if (
        !moved(edge.appliedX1, edge.appliedY1, source.x, source.y) &&
        !moved(edge.appliedX2, edge.appliedY2, target.x, target.y)
      ) {
        continue;
      }
      edge.appliedX1 = source.x;
      edge.appliedY1 = source.y;
      edge.appliedX2 = target.x;
      edge.appliedY2 = target.y;
      edge.element.setAttribute("x1", coordinate(source.x));
      edge.element.setAttribute("y1", coordinate(source.y));
      edge.element.setAttribute("x2", coordinate(target.x));
      edge.element.setAttribute("y2", coordinate(target.y));
    }
  }
}

/** NaN on the first pass, so a node always gets its opening write. */
function moved(appliedX: number, appliedY: number, x: number, y: number): boolean {
  return !(Math.abs(appliedX - x) < MOVEMENT_EPSILON && Math.abs(appliedY - y) < MOVEMENT_EPSILON);
}

function positionLabel(node: PositionedNode, onLeft: boolean): void {
  if (node.label === null) return;
  node.label.setAttribute("x", coordinate(node.labelOffset * (onLeft ? -1 : 1)));
  node.label.setAttribute("text-anchor", onLeft ? "end" : "start");
}

function coordinate(value: number): string {
  return String(Math.round(value * 100) / 100);
}
