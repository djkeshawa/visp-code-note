import {
  DEFAULT_GRAPH_VIEWPORT,
  centerViewport,
  fitViewport,
  panViewport,
  viewportZoomPercent,
  zoomViewport,
} from "./viewportModel.js";
import type { GraphExtent, GraphPoint, GraphViewport } from "./viewportModel.js";
import { clientPointToSvg } from "./svgCoordinates.js";

export class GraphViewportController {
  private viewport: GraphViewport = DEFAULT_GRAPH_VIEWPORT;
  private drag: DragState | undefined;

  public constructor(
    private readonly svg: SVGSVGElement,
    private readonly onChange: (zoomPercent: number) => void,
  ) {
    this.apply(this.viewport);
    svg.addEventListener("wheel", this.handleWheel, { passive: false });
    svg.addEventListener("pointerdown", this.handlePointerDown);
    svg.addEventListener("pointermove", this.handlePointerMove);
    svg.addEventListener("pointerup", this.finishPointerGesture);
    svg.addEventListener("pointercancel", this.finishPointerGesture);
    svg.addEventListener("lostpointercapture", this.finishPointerGesture);
  }

  public zoomBy(factor: number): void {
    this.apply(zoomViewport(this.viewport, viewportCenter(this.viewport), factor));
  }

  public fit(extent: GraphExtent): void {
    const bounds = this.svg.getBoundingClientRect();
    const aspectRatio = bounds.width > 0 && bounds.height > 0
      ? bounds.width / bounds.height
      : DEFAULT_GRAPH_VIEWPORT.width / DEFAULT_GRAPH_VIEWPORT.height;
    this.apply(fitViewport(extent, aspectRatio));
  }

  public center(point: GraphPoint): void {
    this.apply(centerViewport(this.viewport, point));
  }

  public dispose(): void {
    this.svg.removeEventListener("wheel", this.handleWheel);
    this.svg.removeEventListener("pointerdown", this.handlePointerDown);
    this.svg.removeEventListener("pointermove", this.handlePointerMove);
    this.svg.removeEventListener("pointerup", this.finishPointerGesture);
    this.svg.removeEventListener("pointercancel", this.finishPointerGesture);
    this.svg.removeEventListener("lostpointercapture", this.finishPointerGesture);
  }

  private readonly handleWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const anchor = clientPointToSvg(this.svg, event.clientX, event.clientY);
    const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? 16
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? Math.max(1, this.svg.clientHeight) : 1;
    const delta = Math.max(-160, Math.min(160, event.deltaY * unit));
    this.apply(zoomViewport(this.viewport, anchor, Math.exp(-delta * 0.0025)));
  };

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (this.drag !== undefined || event.button !== 0 || nodeFromTarget(event.target) !== undefined) return;
    event.preventDefault();
    this.drag = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY };
    this.svg.setPointerCapture(event.pointerId);
    this.svg.classList.add("is-panning");
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (this.drag?.pointerId !== event.pointerId) return;
    const previous = clientPointToSvg(this.svg, this.drag.clientX, this.drag.clientY);
    const current = clientPointToSvg(this.svg, event.clientX, event.clientY);
    this.drag = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY };
    this.apply(panViewport(this.viewport, {
      x: previous.x - current.x,
      y: previous.y - current.y,
    }));
  };

  private readonly finishPointerGesture = (event: PointerEvent): void => {
    if (this.drag?.pointerId !== event.pointerId) return;
    this.drag = undefined;
    if (this.svg.hasPointerCapture(event.pointerId)) {
      this.svg.releasePointerCapture(event.pointerId);
    }
    this.svg.classList.remove("is-panning");
  };

  private apply(viewport: GraphViewport): void {
    this.viewport = viewport;
    this.svg.setAttribute(
      "viewBox",
      `${viewport.x} ${viewport.y} ${viewport.width} ${viewport.height}`,
    );
    this.onChange(viewportZoomPercent(viewport));
  }

}

interface DragState {
  readonly pointerId: number;
  readonly clientX: number;
  readonly clientY: number;
}

function viewportCenter(viewport: GraphViewport): GraphPoint {
  return { x: viewport.x + viewport.width / 2, y: viewport.y + viewport.height / 2 };
}

function nodeFromTarget(target: EventTarget | null): Element | undefined {
  return target instanceof Element ? target.closest(".graph-node") ?? undefined : undefined;
}
