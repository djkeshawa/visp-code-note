import type { GraphDataWire } from "../contracts.js";
import {
  createForceLinks,
  integrateLiveForces,
} from "./liveForceKernel.js";
import type { ForceLinkState, ForceNodeState } from "./liveForceKernel.js";
import type { GraphBounds, GraphPoint } from "./layout.js";
import { nodeDegrees, nodeRadius } from "./metrics.js";

export interface LiveForceFrame {
  readonly positions: ReadonlyMap<string, GraphPoint>;
  readonly active: boolean;
}

const DEFAULT_BOUNDS: GraphBounds = { width: 960, height: 640 };
const MINIMUM_ALPHA = 0.006;
const MINIMUM_SPEED = 0.025;

export class LiveForceSimulation {
  private readonly nodes: ForceNodeState[];
  private readonly links: readonly ForceLinkState[];
  private readonly idealDistance: number;
  private readonly indexById: ReadonlyMap<string, number>;
  private alpha = 0.72;
  private alphaTarget = 0;

  public constructor(
    graph: GraphDataWire,
    positions: ReadonlyMap<string, GraphPoint>,
    private readonly bounds: GraphBounds = DEFAULT_BOUNDS,
  ) {
    const degrees = nodeDegrees(graph);
    const orderedNodes = [...graph.nodes].sort((left, right) => stableHash(left.id) - stableHash(right.id));
    this.nodes = orderedNodes.map((node) => {
      const point = positions.get(node.id) ?? { x: bounds.width / 2, y: bounds.height / 2 };
      return {
        id: node.id,
        radius: Math.max(10, nodeRadius(node, degrees.get(node.id) ?? 0, graph.focusId === node.id) + 5),
        x: point.x,
        y: point.y,
        vx: initialVelocity(node.id, 17),
        vy: initialVelocity(node.id, 43),
        releaseVelocity: { x: 0, y: 0 },
      };
    });
    this.indexById = new Map(this.nodes.map((node, index) => [node.id, index]));
    this.idealDistance = clamp(
      Math.sqrt((bounds.width * bounds.height) / Math.max(1, this.nodes.length)) * 0.66,
      52,
      108,
    );
    this.links = createForceLinks(graph.edges, this.indexById, this.idealDistance);
  }

  public tick(): LiveForceFrame {
    this.alpha += (this.alphaTarget - this.alpha) * 0.03;
    if (this.alphaTarget === 0 && this.alpha < MINIMUM_ALPHA) this.alpha = 0;
    const maximumSpeed = integrateLiveForces(
      this.nodes,
      this.links,
      this.bounds,
      this.idealDistance,
      this.alpha,
    );
    return {
      positions: this.positions(),
      active: this.hasPinnedNode() || this.alpha > MINIMUM_ALPHA || maximumSpeed > MINIMUM_SPEED,
    };
  }

  public pin(nodeId: string, point: GraphPoint): void {
    const node = this.findNode(nodeId);
    if (node === undefined) return;
    node.pinned = { ...point };
    node.x = point.x;
    node.y = point.y;
    node.vx = 0;
    node.vy = 0;
    node.releaseVelocity = { x: 0, y: 0 };
    this.alphaTarget = 0.18;
    this.reheat(0.48);
  }

  public movePinned(nodeId: string, point: GraphPoint): void {
    const node = this.findNode(nodeId);
    if (node?.pinned === undefined) return;
    const deltaX = point.x - node.pinned.x;
    const deltaY = point.y - node.pinned.y;
    node.releaseVelocity.x = clamp(node.releaseVelocity.x * 0.35 + deltaX * 0.55, -9, 9);
    node.releaseVelocity.y = clamp(node.releaseVelocity.y * 0.35 + deltaY * 0.55, -9, 9);
    node.pinned = { ...point };
    node.x = point.x;
    node.y = point.y;
    this.reheat(0.34);
  }

  public release(nodeId: string): void {
    const node = this.findNode(nodeId);
    if (node?.pinned === undefined) return;
    node.pinned = undefined;
    node.vx = node.releaseVelocity.x;
    node.vy = node.releaseVelocity.y;
    node.releaseVelocity = { x: 0, y: 0 };
    this.alphaTarget = this.hasPinnedNode() ? 0.18 : 0;
    this.reheat(0.44);
  }

  public positions(): ReadonlyMap<string, GraphPoint> {
    return new Map(this.nodes.map((node) => [node.id, { x: node.x, y: node.y }]));
  }

  private reheat(alpha: number): void {
    this.alpha = Math.max(this.alpha, alpha);
  }

  private findNode(nodeId: string): ForceNodeState | undefined {
    const index = this.indexById.get(nodeId);
    return index === undefined ? undefined : this.nodes[index];
  }

  private hasPinnedNode(): boolean {
    return this.nodes.some((node) => node.pinned !== undefined);
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
