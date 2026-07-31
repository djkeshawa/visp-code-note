import { dragThresholdExceeded, movedGraphPositions } from "./dragModel.js";
import type { GraphPoint } from "./layout.js";
import {
  beginPointerCapture,
  endPointerCapture,
  type CapturedPointer,
} from "./pointerCapture.js";
import { clientPointToSvg } from "./svgCoordinates.js";

interface NodeDragCallbacks {
  readonly onStart: (nodeId: string, point: GraphPoint) => void;
  readonly onMove: (nodeId: string, point: GraphPoint) => void;
  readonly onEnd: (nodeId: string) => void;
}

interface ConnectedEdge {
  readonly element: SVGLineElement;
  readonly endpoint: "source" | "target";
}

interface DragState {
  readonly capture: CapturedPointer;
  readonly nodeId: string;
  readonly element: SVGGElement;
  readonly offset: GraphPoint;
  readonly startClient: GraphPoint;
  readonly edges: readonly ConnectedEdge[];
  point: GraphPoint;
  moved: boolean;
}

export class GraphNodeDragController {
  private positions: ReadonlyMap<string, GraphPoint> = new Map();
  private drag: DragState | undefined;
  private suppressClick = false;
  /**
   * Where a node's label flips to its other side, kept in step with the layout the way
   * `GraphPositionUpdater` keeps it. This was written into `positionNode` as a literal, which is
   * the midpoint of the smallest layout only, so in any larger graph a dragged node's label
   * jumped to the wrong side partway across and stayed there once the drag ended.
   */
  private midX = 480;

  public constructor(
    private readonly svg: SVGSVGElement,
    private readonly callbacks: NodeDragCallbacks,
  ) {
    svg.addEventListener("pointerdown", this.handlePointerDown);
    svg.addEventListener("pointermove", this.handlePointerMove);
    svg.addEventListener("pointerup", this.finishPointerGesture);
    svg.addEventListener("pointercancel", this.finishPointerGesture);
    svg.addEventListener("lostpointercapture", this.finishPointerGesture);
    svg.addEventListener("click", this.suppressPostDragClick, true);
  }

  public setPositions(positions: ReadonlyMap<string, GraphPoint>): void {
    this.positions = positions;
  }

  public setMidX(midX: number): void {
    this.midX = midX;
  }

  public dispose(): void {
    this.svg.removeEventListener("pointerdown", this.handlePointerDown);
    this.svg.removeEventListener("pointermove", this.handlePointerMove);
    this.svg.removeEventListener("pointerup", this.finishPointerGesture);
    this.svg.removeEventListener("pointercancel", this.finishPointerGesture);
    this.svg.removeEventListener("lostpointercapture", this.finishPointerGesture);
    this.svg.removeEventListener("click", this.suppressPostDragClick, true);
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (this.drag !== undefined || event.button !== 0) return;
    const element = nodeFromTarget(event.target);
    const nodeId = element?.dataset.nodeId;
    const origin = nodeId === undefined ? undefined : this.positions.get(nodeId);
    if (element === undefined || nodeId === undefined || origin === undefined) return;

    const pointer = clientPointToSvg(this.svg, event.clientX, event.clientY);
    this.suppressClick = false;
    const capture = beginPointerCapture(element, event.pointerId);
    this.drag = {
      capture,
      nodeId,
      element,
      offset: { x: origin.x - pointer.x, y: origin.y - pointer.y },
      startClient: { x: event.clientX, y: event.clientY },
      edges: connectedEdges(this.svg, nodeId),
      point: origin,
      moved: false,
    };
    element.classList.add("is-dragging");
    this.svg.classList.add("is-node-dragging");
    this.callbacks.onStart(nodeId, origin);
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    const drag = this.drag;
    if (drag?.capture.pointerId !== event.pointerId) return;
    drag.moved ||= dragThresholdExceeded(drag.startClient, { x: event.clientX, y: event.clientY });
    if (!drag.moved) return;

    event.preventDefault();
    const pointer = clientPointToSvg(this.svg, event.clientX, event.clientY);
    drag.point = { x: pointer.x + drag.offset.x, y: pointer.y + drag.offset.y };
    positionNode(drag, drag.point, this.midX);
    this.positions = movedGraphPositions(this.positions, drag.nodeId, drag.point);
    this.callbacks.onMove(drag.nodeId, drag.point);
  };

  private readonly finishPointerGesture = (event: PointerEvent): void => {
    const drag = this.drag;
    if (drag?.capture.pointerId !== event.pointerId) return;
    this.drag = undefined;
    drag.element.classList.remove("is-dragging");
    this.svg.classList.remove("is-node-dragging");
    endPointerCapture(drag.capture);
    this.callbacks.onEnd(drag.nodeId);
    if (drag.moved) {
      this.suppressClick = event.type === "pointerup";
    }
  };

  private readonly suppressPostDragClick = (event: MouseEvent): void => {
    if (!this.suppressClick) return;
    this.suppressClick = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
}

function positionNode(drag: DragState, point: GraphPoint, midX: number): void {
  drag.element.setAttribute("transform", `translate(${point.x} ${point.y})`);
  positionLabel(drag.element, point.x > midX);
  for (const edge of drag.edges) {
    const suffix = edge.endpoint === "source" ? "1" : "2";
    edge.element.setAttribute(`x${suffix}`, String(point.x));
    edge.element.setAttribute(`y${suffix}`, String(point.y));
  }
}

function positionLabel(element: SVGGElement, onLeft: boolean): void {
  const label = element.querySelector<SVGTextElement>(".node-label");
  const offset = Number(element.dataset.labelOffset);
  if (label === null || !Number.isFinite(offset)) return;
  label.setAttribute("x", String(offset * (onLeft ? -1 : 1)));
  label.setAttribute("text-anchor", onLeft ? "end" : "start");
}

function connectedEdges(svg: SVGSVGElement, nodeId: string): readonly ConnectedEdge[] {
  const result: ConnectedEdge[] = [];
  for (const element of Array.from(svg.querySelectorAll<SVGLineElement>(".graph-edge"))) {
    if (element.dataset.sourceId === nodeId) result.push({ element, endpoint: "source" });
    if (element.dataset.targetId === nodeId) result.push({ element, endpoint: "target" });
  }
  return result;
}

function nodeFromTarget(target: EventTarget | null): SVGGElement | undefined {
  return target instanceof Element
    ? target.closest<SVGGElement>(".graph-node") ?? undefined
    : undefined;
}
