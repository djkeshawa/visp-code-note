import type { GraphPoint } from "./layout.js";

interface PositionedNode {
  readonly id: string;
  readonly element: SVGGElement;
  readonly label: SVGTextElement | null;
  readonly labelOffset: number;
}

interface PositionedEdge {
  readonly element: SVGLineElement;
  readonly sourceId: string;
  readonly targetId: string;
}

export class GraphPositionUpdater {
  private nodes: readonly PositionedNode[] = [];
  private edges: readonly PositionedEdge[] = [];

  public constructor(private readonly svg: SVGSVGElement) {}

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
            }];
      });
    this.edges = Array.from(this.svg.querySelectorAll<SVGLineElement>(".graph-edge"))
      .flatMap((element) => {
        const sourceId = element.dataset.sourceId;
        const targetId = element.dataset.targetId;
        return sourceId === undefined || targetId === undefined
          ? []
          : [{ element, sourceId, targetId }];
      });
  }

  public apply(positions: ReadonlyMap<string, GraphPoint>): void {
    for (const node of this.nodes) {
      const point = positions.get(node.id);
      if (point === undefined) continue;
      node.element.setAttribute("transform", `translate(${coordinate(point.x)} ${coordinate(point.y)})`);
      positionLabel(node, point.x > 480);
    }
    for (const edge of this.edges) {
      const source = positions.get(edge.sourceId);
      const target = positions.get(edge.targetId);
      if (source === undefined || target === undefined) continue;
      edge.element.setAttribute("x1", coordinate(source.x));
      edge.element.setAttribute("y1", coordinate(source.y));
      edge.element.setAttribute("x2", coordinate(target.x));
      edge.element.setAttribute("y2", coordinate(target.y));
    }
  }
}

function positionLabel(node: PositionedNode, onLeft: boolean): void {
  if (node.label === null) return;
  node.label.setAttribute("x", coordinate(node.labelOffset * (onLeft ? -1 : 1)));
  node.label.setAttribute("text-anchor", onLeft ? "end" : "start");
}

function coordinate(value: number): string {
  return String(Math.round(value * 100) / 100);
}
