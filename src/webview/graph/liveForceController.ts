import type { GraphDataWire } from "../contracts.js";
import type { GraphPoint } from "./layout.js";
import { LiveForceSimulation } from "./liveForceSimulation.js";

type PositionListener = (positions: ReadonlyMap<string, GraphPoint>) => void;

export class LiveForceController {
  private simulation: LiveForceSimulation | undefined;
  private animationFrame: number | undefined;

  public constructor(
    private readonly onPositionChange: PositionListener,
    private readonly motionEnabled: () => boolean,
  ) {}

  public start(graph: GraphDataWire, positions: ReadonlyMap<string, GraphPoint>): void {
    this.stop();
    if (graph.nodes.length === 0) return;
    this.simulation = new LiveForceSimulation(graph, positions);
    this.scheduleFrame();
  }

  public pin(nodeId: string, point: GraphPoint): void {
    this.simulation?.pin(nodeId, point);
    this.scheduleFrame();
  }

  public movePinned(nodeId: string, point: GraphPoint): void {
    this.simulation?.movePinned(nodeId, point);
    this.scheduleFrame();
  }

  public release(nodeId: string): void {
    this.simulation?.release(nodeId);
    this.scheduleFrame();
  }

  public stop(): void {
    if (this.animationFrame !== undefined) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = undefined;
    this.simulation = undefined;
  }

  public dispose(): void {
    this.stop();
  }

  private scheduleFrame(): void {
    if (
      this.animationFrame !== undefined
      || this.simulation === undefined
      || !this.motionEnabled()
    ) {
      return;
    }
    this.animationFrame = requestAnimationFrame(this.runFrame);
  }

  private readonly runFrame = (): void => {
    this.animationFrame = undefined;
    const frame = this.simulation?.tick();
    if (frame === undefined) return;
    this.onPositionChange(frame.positions);
    if (frame.active) this.scheduleFrame();
  };
}
