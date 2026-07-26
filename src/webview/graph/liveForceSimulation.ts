import type { GraphDataWire } from "../contracts.js";
import {
  ForceBuffers,
  createForceLinks,
  integrateLiveForces,
  pinNode,
  releaseNode,
} from "./liveForceKernel.js";
import type { ForceLinks } from "./liveForceKernel.js";
import { graphLayoutBounds } from "./layout.js";
import type { GraphBounds, GraphPoint } from "./layout.js";
import { nodeDegrees, nodeRadius } from "./metrics.js";

export interface LiveForceFrame {
  readonly positions: ReadonlyMap<string, GraphPoint>;
  readonly active: boolean;
}

const MINIMUM_ALPHA = 0.006;
const MINIMUM_SPEED = 0.025;

interface MutablePoint {
  x: number;
  y: number;
}

export class LiveForceSimulation {
  private readonly ids: readonly string[];
  private readonly indexById: ReadonlyMap<string, number>;
  private readonly buffers: ForceBuffers;
  private readonly links: ForceLinks;
  private readonly idealDistance: number;
  private readonly bounds: GraphBounds;

  /**
   * One map and one point object per node, reused across every frame. Consumers read a
   * frame and apply it immediately, so handing back a live view avoids rebuilding a map of
   * fresh objects sixty times a second.
   */
  private readonly points: readonly MutablePoint[];
  private readonly positionView: ReadonlyMap<string, GraphPoint>;

  private alpha = 0.72;
  private alphaTarget = 0;

  public constructor(
    graph: GraphDataWire,
    positions: ReadonlyMap<string, GraphPoint>,
    bounds: GraphBounds = graphLayoutBounds(graph.nodes.length),
  ) {
    this.bounds = bounds;
    const degrees = nodeDegrees(graph);
    const orderedNodes = [...graph.nodes]
      .sort((left, right) => stableHash(left.id) - stableHash(right.id));

    this.ids = orderedNodes.map((node) => node.id);
    this.indexById = new Map(this.ids.map((id, index) => [id, index]));
    this.buffers = new ForceBuffers(orderedNodes.length);

    for (const [index, node] of orderedNodes.entries()) {
      const point = positions.get(node.id) ?? { x: bounds.width / 2, y: bounds.height / 2 };
      this.buffers.x[index] = point.x;
      this.buffers.y[index] = point.y;
      this.buffers.vx[index] = initialVelocity(node.id, 17);
      this.buffers.vy[index] = initialVelocity(node.id, 43);
      this.buffers.radius[index] = Math.max(
        10,
        nodeRadius(node, degrees.get(node.id) ?? 0, graph.focusId === node.id) + 5,
      );
    }

    this.idealDistance = clamp(
      Math.sqrt((bounds.width * bounds.height) / Math.max(1, orderedNodes.length)) * 0.66,
      52,
      108,
    );
    this.links = createForceLinks(graph.edges, this.indexById, this.idealDistance);

    const points = orderedNodes.map((_, index) => ({
      x: this.buffers.x[index]!,
      y: this.buffers.y[index]!,
    }));
    this.points = points;
    this.positionView = new Map(this.ids.map((id, index) => [id, points[index]!]));
  }

  public tick(): LiveForceFrame {
    this.alpha += (this.alphaTarget - this.alpha) * 0.03;
    if (this.alphaTarget === 0 && this.alpha < MINIMUM_ALPHA) this.alpha = 0;
    const maximumSpeed = integrateLiveForces(
      this.buffers,
      this.links,
      this.bounds,
      this.idealDistance,
      this.alpha,
    );
    this.syncPoints();
    return {
      positions: this.positionView,
      active: this.buffers.hasPinnedNode() ||
        this.alpha > MINIMUM_ALPHA ||
        maximumSpeed > MINIMUM_SPEED,
    };
  }

  public pin(nodeId: string, point: GraphPoint): void {
    const index = this.indexById.get(nodeId);
    if (index === undefined) return;
    pinNode(this.buffers, index, point);
    this.syncPoint(index);
    this.alphaTarget = 0.18;
    this.reheat(0.48);
  }

  public movePinned(nodeId: string, point: GraphPoint): void {
    const index = this.indexById.get(nodeId);
    if (index === undefined || this.buffers.pinned[index] !== 1) return;
    const deltaX = point.x - this.buffers.pinnedX[index]!;
    const deltaY = point.y - this.buffers.pinnedY[index]!;
    this.buffers.releaseVX[index] = clamp(
      this.buffers.releaseVX[index]! * 0.35 + deltaX * 0.55,
      -9,
      9,
    );
    this.buffers.releaseVY[index] = clamp(
      this.buffers.releaseVY[index]! * 0.35 + deltaY * 0.55,
      -9,
      9,
    );
    this.buffers.pinnedX[index] = point.x;
    this.buffers.pinnedY[index] = point.y;
    this.buffers.x[index] = point.x;
    this.buffers.y[index] = point.y;
    this.syncPoint(index);
    this.reheat(0.34);
  }

  public release(nodeId: string): void {
    const index = this.indexById.get(nodeId);
    if (index === undefined || this.buffers.pinned[index] !== 1) return;
    releaseNode(this.buffers, index);
    this.alphaTarget = this.buffers.hasPinnedNode() ? 0.18 : 0;
    this.reheat(0.44);
  }

  public positions(): ReadonlyMap<string, GraphPoint> {
    return this.positionView;
  }

  private syncPoints(): void {
    for (let index = 0; index < this.points.length; index += 1) {
      const point = this.points[index]!;
      point.x = this.buffers.x[index]!;
      point.y = this.buffers.y[index]!;
    }
  }

  private syncPoint(index: number): void {
    const point = this.points[index];
    if (point === undefined) return;
    point.x = this.buffers.x[index]!;
    point.y = this.buffers.y[index]!;
  }

  private reheat(alpha: number): void {
    this.alpha = Math.max(this.alpha, alpha);
  }
}

function initialVelocity(id: string, salt: number): number {
  return ((stableHash(`${salt}:${id}`) % 1000) / 999 - 0.5) * 0.8;
}

function stableHash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result = Math.imul(result ^ value.charCodeAt(index), 16777619);
  }
  return result >>> 0;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
