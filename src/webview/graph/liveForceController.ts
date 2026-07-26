import type { GraphDataWire } from "../contracts.js";
import type { GraphPoint } from "./layout.js";
import { LiveForceSimulation } from "./liveForceSimulation.js";

type PositionListener = (positions: ReadonlyMap<string, GraphPoint>) => void;

/** Wall-clock ceiling for the reduced-motion settle, so the panel stays responsive. */
const SETTLE_BUDGET_MS = 180;
const MAX_SETTLE_TICKS = 400;

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
    if (this.motionEnabled()) {
      this.scheduleFrame();
    } else {
      this.settleWithoutMotion();
    }
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

  /**
   * When the viewer prefers reduced motion the animation loop never runs, which used to
   * leave the graph showing the opening settle pass. Running the same simulation to rest in
   * one pass gives those viewers the settled layout without any animation. The budget keeps
   * a very large workspace from blocking the webview.
   */
  private settleWithoutMotion(): void {
    const simulation = this.simulation;
    if (simulation === undefined) return;
    const deadline = Date.now() + SETTLE_BUDGET_MS;
    let frame = simulation.tick();
    let ticks = 1;
    while (frame.active && ticks < MAX_SETTLE_TICKS && Date.now() < deadline) {
      frame = simulation.tick();
      ticks += 1;
    }
    this.onPositionChange(frame.positions);
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
