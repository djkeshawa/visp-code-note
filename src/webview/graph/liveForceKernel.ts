import type { GraphEdgeWire } from "../contracts.js";
import { BarnesHutField } from "./barnesHut.js";
import type { RepulsionSettings } from "./barnesHut.js";
import type { GraphBounds, GraphPoint } from "./layout.js";

/**
 * Simulation state held in parallel typed arrays rather than one object per node.
 *
 * The arrays are allocated once and reused, so a tick performs no allocation. That matters
 * because this runs on every animation frame: the previous shape allocated a force object
 * per node per frame, which at a few thousand nodes meant hundreds of thousands of
 * short-lived objects per second and the collection pauses that come with them.
 */
export class ForceBuffers {
  public readonly x: Float64Array;
  public readonly y: Float64Array;
  public readonly vx: Float64Array;
  public readonly vy: Float64Array;
  public readonly radius: Float64Array;
  public readonly forceX: Float64Array;
  public readonly forceY: Float64Array;

  /** 1 when a drag holds the node, in which case forces do not move it. */
  public readonly pinned: Uint8Array;
  public readonly pinnedX: Float64Array;
  public readonly pinnedY: Float64Array;

  /** Velocity handed back when a drag releases a node, which gives the throw momentum. */
  public readonly releaseVX: Float64Array;
  public readonly releaseVY: Float64Array;

  private readonly field: BarnesHutField;

  public constructor(public readonly count: number) {
    this.x = new Float64Array(count);
    this.y = new Float64Array(count);
    this.vx = new Float64Array(count);
    this.vy = new Float64Array(count);
    this.radius = new Float64Array(count);
    this.forceX = new Float64Array(count);
    this.forceY = new Float64Array(count);
    this.pinned = new Uint8Array(count);
    this.pinnedX = new Float64Array(count);
    this.pinnedY = new Float64Array(count);
    this.releaseVX = new Float64Array(count);
    this.releaseVY = new Float64Array(count);
    this.field = new BarnesHutField(count);
  }

  public rebuildField(): void {
    this.field.build(this.x, this.y, this.count);
  }

  public accumulateRepulsion(
    index: number,
    idealDistance: number,
    alpha: number,
    settings: RepulsionSettings,
  ): void {
    this.field.accumulate(
      index,
      this.x,
      this.y,
      this.radius,
      this.forceX,
      this.forceY,
      idealDistance,
      alpha,
      settings,
    );
  }

  public hasPinnedNode(): boolean {
    for (let index = 0; index < this.count; index += 1) {
      if (this.pinned[index] === 1) return true;
    }
    return false;
  }
}

export interface ForceLinks {
  readonly source: Int32Array;
  readonly target: Int32Array;
  readonly distance: Float64Array;
}

const REPULSION: RepulsionSettings = { strength: 0.026, collisionStrength: 0.11, theta: 1.5 };
const LINK_STRENGTH = 0.034;
const VELOCITY_DECAY = 0.78;
const CENTER_PULL = 0.0035;
const MAX_SPEED = 11;
const PADDING = 48;

export function createForceLinks(
  edges: readonly GraphEdgeWire[],
  indexById: ReadonlyMap<string, number>,
  idealDistance: number,
): ForceLinks {
  const source: number[] = [];
  const target: number[] = [];
  const distance: number[] = [];
  for (const edge of edges) {
    const from = indexById.get(edge.source);
    const to = indexById.get(edge.target);
    if (from === undefined || to === undefined || from === to) continue;
    source.push(from);
    target.push(to);
    distance.push(idealDistance * (edge.kind === "link" ? 1 : 0.76));
  }
  return {
    source: Int32Array.from(source),
    target: Int32Array.from(target),
    distance: Float64Array.from(distance),
  };
}

/**
 * Advances the simulation one step and returns the fastest node speed, which the caller
 * uses to decide whether the layout has come to rest.
 */
export function integrateLiveForces(
  buffers: ForceBuffers,
  links: ForceLinks,
  bounds: GraphBounds,
  idealDistance: number,
  alpha: number,
): number {
  const { count, forceX, forceY } = buffers;
  forceX.fill(0);
  forceY.fill(0);

  buffers.rebuildField();
  for (let index = 0; index < count; index += 1) {
    buffers.accumulateRepulsion(index, idealDistance, alpha, REPULSION);
  }
  applyLinkForces(buffers, links, alpha);
  return integrateNodes(buffers, bounds, alpha);
}

function applyLinkForces(buffers: ForceBuffers, links: ForceLinks, alpha: number): void {
  const { x, y, forceX, forceY } = buffers;
  for (let link = 0; link < links.source.length; link += 1) {
    const from = links.source[link]!;
    const to = links.target[link]!;
    const dx = x[to]! - x[from]!;
    const dy = y[to]! - y[from]!;
    const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
    const strength = (distance - links.distance[link]!) * LINK_STRENGTH * alpha;
    const pushX = (dx / distance) * strength;
    const pushY = (dy / distance) * strength;
    forceX[from] = forceX[from]! + pushX;
    forceY[from] = forceY[from]! + pushY;
    forceX[to] = forceX[to]! - pushX;
    forceY[to] = forceY[to]! - pushY;
  }
}

function integrateNodes(buffers: ForceBuffers, bounds: GraphBounds, alpha: number): number {
  const { count, x, y, vx, vy, forceX, forceY, pinned, pinnedX, pinnedY } = buffers;
  const centerX = bounds.width / 2;
  const centerY = bounds.height / 2;
  const maximumX = bounds.width - PADDING;
  const maximumY = bounds.height - PADDING;
  const centerPull = CENTER_PULL * alpha;
  let maximumSpeed = 0;

  for (let index = 0; index < count; index += 1) {
    if (pinned[index] === 1) {
      x[index] = pinnedX[index]!;
      y[index] = pinnedY[index]!;
      vx[index] = 0;
      vy[index] = 0;
      continue;
    }
    const boundaryX = boundaryForce(x[index]!, PADDING, maximumX) * alpha;
    const boundaryY = boundaryForce(y[index]!, PADDING, maximumY) * alpha;
    let nextVX = (vx[index]! + forceX[index]! + (centerX - x[index]!) * centerPull + boundaryX) *
      VELOCITY_DECAY;
    let nextVY = (vy[index]! + forceY[index]! + (centerY - y[index]!) * centerPull + boundaryY) *
      VELOCITY_DECAY;
    const speed = Math.sqrt(nextVX * nextVX + nextVY * nextVY);
    if (speed > MAX_SPEED) {
      const scale = MAX_SPEED / speed;
      nextVX *= scale;
      nextVY *= scale;
    }
    vx[index] = nextVX;
    vy[index] = nextVY;
    x[index] = x[index]! + nextVX;
    y[index] = y[index]! + nextVY;
    if (speed > maximumSpeed) maximumSpeed = Math.min(speed, MAX_SPEED);
  }
  return maximumSpeed;
}

function boundaryForce(value: number, minimum: number, maximum: number): number {
  if (value < minimum) return (minimum - value) * 0.1;
  if (value > maximum) return (maximum - value) * 0.1;
  return 0;
}

export function pinNode(buffers: ForceBuffers, index: number, point: GraphPoint): void {
  buffers.pinned[index] = 1;
  buffers.pinnedX[index] = point.x;
  buffers.pinnedY[index] = point.y;
  buffers.x[index] = point.x;
  buffers.y[index] = point.y;
  buffers.vx[index] = 0;
  buffers.vy[index] = 0;
  buffers.releaseVX[index] = 0;
  buffers.releaseVY[index] = 0;
}

export function releaseNode(buffers: ForceBuffers, index: number): void {
  buffers.pinned[index] = 0;
  buffers.vx[index] = buffers.releaseVX[index]!;
  buffers.vy[index] = buffers.releaseVY[index]!;
  buffers.releaseVX[index] = 0;
  buffers.releaseVY[index] = 0;
}
