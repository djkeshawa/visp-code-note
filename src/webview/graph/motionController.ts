import type { GraphDataWire } from "../contracts.js";
import { movedGraphPositions } from "./dragModel.js";
import { graphLayoutBounds } from "./layout.js";
import type { GraphPoint } from "./layout.js";
import { LiveForceController } from "./liveForceController.js";
import { GraphNodeDragController } from "./nodeDragController.js";
import { GraphPositionUpdater } from "./positionUpdater.js";
import { graphExtentForPositions, renderGraphSvg } from "./renderer.js";
import type { RenderedGraph } from "./renderer.js";

type RenderListener = (rendered: RenderedGraph) => void;

export class GraphMotionController {
  private rendered: RenderedGraph = { positions: new Map() };
  private readonly positionUpdater: GraphPositionUpdater;
  private readonly simulation: LiveForceController;
  private readonly nodeDrag: GraphNodeDragController;

  public constructor(
    private readonly svg: SVGSVGElement,
    private readonly onRender: RenderListener,
    motionEnabled: () => boolean,
  ) {
    this.positionUpdater = new GraphPositionUpdater(svg);
    this.simulation = new LiveForceController(this.updateSimulatedPositions, motionEnabled);
    this.nodeDrag = new GraphNodeDragController(svg, {
      onStart: this.beginDrag,
      onMove: this.moveDraggedNode,
      onEnd: this.finishDrag,
    });
  }

  public render(
    graph: GraphDataWire,
    selectedId: string | undefined,
    retainedPositions: ReadonlyMap<string, GraphPoint>,
  ): RenderedGraph {
    this.simulation.stop();
    this.rendered = renderGraphSvg(this.svg, graph, selectedId, retainedPositions);
    const midX = graphLayoutBounds(graph.nodes.length).width / 2;
    this.positionUpdater.setMidX(midX);
    this.positionUpdater.refresh();
    this.nodeDrag.setMidX(midX);
    this.nodeDrag.setPositions(this.rendered.positions);
    this.simulation.start(graph, this.rendered.positions);
    return this.rendered;
  }

  public dispose(): void {
    this.simulation.dispose();
    this.nodeDrag.dispose();
  }

  private readonly beginDrag = (nodeId: string, point: GraphPoint): void => {
    this.simulation.pin(nodeId, point);
  };

  private readonly moveDraggedNode = (nodeId: string, point: GraphPoint): void => {
    this.simulation.movePinned(nodeId, point);
    this.publish({
      ...this.rendered,
      positions: movedGraphPositions(this.rendered.positions, nodeId, point),
    });
  };

  private readonly finishDrag = (nodeId: string): void => {
    this.simulation.release(nodeId);
    this.publish({
      ...this.rendered,
      extent: graphExtentForPositions(this.rendered.positions),
    });
  };

  private readonly updateSimulatedPositions = (
    positions: ReadonlyMap<string, GraphPoint>,
  ): void => {
    this.positionUpdater.apply(positions);
    this.nodeDrag.setPositions(positions);
    this.publish({ positions, extent: graphExtentForPositions(positions) });
  };

  private publish(rendered: RenderedGraph): void {
    this.rendered = rendered;
    this.onRender(rendered);
  }
}
