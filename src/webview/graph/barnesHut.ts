/**
 * Barnes–Hut repulsion over a quadtree.
 *
 * Repulsion is the expensive half of a force-directed layout: every node pushes every
 * other node, which is O(n²) done exactly. The previous approach kept that exact loop up
 * to a node-count limit and then fell back to repelling each node against a fixed number
 * of neighbours chosen by hash order. That is O(n), but those neighbours are not the ones
 * nearby on the canvas, so past the limit nodes stopped separating and piled up.
 *
 * A quadtree fixes both halves. Nearby nodes are still compared exactly — which is what
 * collision separation needs — while a distant cluster is summarised by its centre of
 * mass and counted once. Accuracy is governed by `theta`: a cell stands in for its
 * contents once its width over its distance drops below it. That gives O(n log n) per
 * pass with the near field intact.
 *
 * Every buffer is allocated once per instance and reused, so a 60fps simulation performs
 * no allocation per frame.
 */

const LEAF_CAPACITY = 4;
const MAX_DEPTH = 22;
const DEFAULT_THETA = 0.9;

/** Slots per cell in `childCells`: one per quadrant. */
const QUADRANTS = 4;

/**
 * Cell 0 is always the root, so it can never be another cell's child. That lets 0 double
 * as the "no child in this quadrant" sentinel without a separate occupancy array.
 */
const NO_CHILD = 0;

export interface RepulsionSettings {
  /** Scales the inverse-square push. Higher spreads the graph further apart. */
  readonly strength: number;
  /** Extra push applied when two nodes are closer than the sum of their radii. */
  readonly collisionStrength: number;
  /** Barnes–Hut accuracy. 0 is exact and slow; ~1 is the usual quality/speed balance. */
  readonly theta?: number;
}

export class BarnesHutField {
  private readonly order: Int32Array;
  private readonly scratch: Int32Array;
  private readonly cellStart: Int32Array;
  private readonly cellCount: Int32Array;
  private readonly childCells: Int32Array;
  private readonly centreX: Float64Array;
  private readonly centreY: Float64Array;
  private readonly mass: Float64Array;
  private readonly size: Float64Array;
  private readonly traversal: Int32Array;

  /** Scratch for `partition`, kept per depth level so recursion never allocates. */
  private readonly quadrantCounts: Int32Array;
  private readonly quadrantBounds: Int32Array;
  private readonly quadrantCursors: Int32Array;

  private readonly maxCells: number;
  private cells = 0;

  public constructor(capacity: number) {
    this.maxCells = Math.max(16, capacity * 4 + 16);
    this.order = new Int32Array(Math.max(1, capacity));
    this.scratch = new Int32Array(Math.max(1, capacity));
    this.cellStart = new Int32Array(this.maxCells);
    this.cellCount = new Int32Array(this.maxCells);
    this.childCells = new Int32Array(this.maxCells * QUADRANTS);
    this.centreX = new Float64Array(this.maxCells);
    this.centreY = new Float64Array(this.maxCells);
    this.mass = new Float64Array(this.maxCells);
    this.size = new Float64Array(this.maxCells);
    // Popping one cell and pushing its four children nets three per level.
    this.traversal = new Int32Array(MAX_DEPTH * 3 + QUADRANTS + 2);
    const levels = MAX_DEPTH + 2;
    this.quadrantCounts = new Int32Array(levels * QUADRANTS);
    this.quadrantBounds = new Int32Array(levels * (QUADRANTS + 1));
    this.quadrantCursors = new Int32Array(levels * QUADRANTS);
  }

  /**
   * Rebuilds the tree for the current positions. `count` may be below the instance
   * capacity, so one field can serve a graph that shrinks.
   */
  public build(x: Float64Array, y: Float64Array, count: number): void {
    this.cells = 0;
    if (count <= 0) return;

    let minX = x[0]!;
    let maxX = minX;
    let minY = y[0]!;
    let maxY = minY;
    for (let index = 0; index < count; index += 1) {
      const px = x[index]!;
      const py = y[index]!;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
      this.order[index] = index;
    }

    // A square root cell keeps the quadrant split isotropic.
    const half = Math.max(1, Math.max(maxX - minX, maxY - minY) / 2 + 1);
    this.subdivide(x, y, 0, count, (minX + maxX) / 2, (minY + maxY) / 2, half, 0);
  }

  /**
   * Adds the repulsion felt by the node at `index` into `forceX`/`forceY`.
   * `radius` supplies collision distances; `alpha` is the simulation's cooling factor.
   */
  public accumulate(
    index: number,
    x: Float64Array,
    y: Float64Array,
    radius: Float64Array,
    forceX: Float64Array,
    forceY: Float64Array,
    idealDistance: number,
    alpha: number,
    settings: RepulsionSettings,
  ): void {
    if (this.cells === 0) return;
    const theta = settings.theta ?? DEFAULT_THETA;
    const thetaSquared = theta * theta;
    const repulsionScale = idealDistance * idealDistance * settings.strength * alpha;
    const collisionStrength = settings.collisionStrength * alpha;
    const px = x[index]!;
    const py = y[index]!;
    const pr = radius[index]!;
    let pushX = 0;
    let pushY = 0;

    const stack = this.traversal;
    let top = 0;
    stack[top] = 0;

    while (top >= 0) {
      const cell = stack[top]!;
      top -= 1;
      const childBase = cell * QUADRANTS;

      if (
        this.childCells[childBase] === NO_CHILD &&
        this.childCells[childBase + 1] === NO_CHILD &&
        this.childCells[childBase + 2] === NO_CHILD &&
        this.childCells[childBase + 3] === NO_CHILD
      ) {
        const start = this.cellStart[cell]!;
        const end = start + this.cellCount[cell]!;
        for (let slot = start; slot < end; slot += 1) {
          const other = this.order[slot]!;
          if (other === index) continue;
          let dx = px - x[other]!;
          let dy = py - y[other]!;
          if (dx === 0 && dy === 0) {
            // Coincident nodes are nudged along an axis derived from the pair, so a node
            // stacked with several others gets pushes that do not cancel each other out.
            const angle = coincidentAngle(index, other);
            const sign = index < other ? 1 : -1;
            dx = Math.cos(angle) * 0.01 * sign;
            dy = Math.sin(angle) * 0.01 * sign;
          }
          const distanceSquared = Math.max(25, dx * dx + dy * dy);
          const distance = Math.sqrt(distanceSquared);
          const repulsion = repulsionScale / distanceSquared;
          const separation = pr + radius[other]!;
          const overlap = distance < separation
            ? (separation - distance) * collisionStrength
            : 0;
          pushX += dx * repulsion + (dx / distance) * overlap;
          pushY += dy * repulsion + (dy / distance) * overlap;
        }
        continue;
      }

      const dx = px - this.centreX[cell]!;
      const dy = py - this.centreY[cell]!;
      const distanceSquared = dx * dx + dy * dy;
      const width = this.size[cell]!;

      if (distanceSquared > 0 && width * width < thetaSquared * distanceSquared) {
        const push = (repulsionScale * this.mass[cell]!) / Math.max(25, distanceSquared);
        pushX += dx * push;
        pushY += dy * push;
        continue;
      }

      for (let quadrant = 0; quadrant < QUADRANTS; quadrant += 1) {
        const child = this.childCells[childBase + quadrant]!;
        if (child !== NO_CHILD && top < stack.length - 1) {
          top += 1;
          stack[top] = child;
        }
      }
    }

    forceX[index] = forceX[index]! + pushX;
    forceY[index] = forceY[index]! + pushY;
  }

  /**
   * Builds one cell over `order[lo, hi)` and returns its index, or -1 when the cell
   * budget is exhausted. Points are partitioned in place, so each level costs one pass
   * over the range it owns.
   */
  private subdivide(
    x: Float64Array,
    y: Float64Array,
    lo: number,
    hi: number,
    cx: number,
    cy: number,
    half: number,
    depth: number,
  ): number {
    if (this.cells >= this.maxCells) return -1;
    const cell = this.cells;
    this.cells += 1;

    const childBase = cell * QUADRANTS;
    this.childCells[childBase] = NO_CHILD;
    this.childCells[childBase + 1] = NO_CHILD;
    this.childCells[childBase + 2] = NO_CHILD;
    this.childCells[childBase + 3] = NO_CHILD;
    this.cellStart[cell] = lo;
    this.cellCount[cell] = hi - lo;
    this.size[cell] = half * 2;

    const count = hi - lo;
    // Leaves keep their points for exact comparison, which is what collisions need.
    if (
      count <= LEAF_CAPACITY ||
      depth >= MAX_DEPTH ||
      this.cells + QUADRANTS >= this.maxCells
    ) {
      let sumX = 0;
      let sumY = 0;
      for (let slot = lo; slot < hi; slot += 1) {
        const point = this.order[slot]!;
        sumX += x[point]!;
        sumY += y[point]!;
      }
      this.mass[cell] = count;
      this.centreX[cell] = count === 0 ? cx : sumX / count;
      this.centreY[cell] = count === 0 ? cy : sumY / count;
      return cell;
    }

    const boundsBase = depth * (QUADRANTS + 1);
    this.partition(x, y, lo, hi, cx, cy, depth);
    const quarter = half / 2;
    let sumX = 0;
    let sumY = 0;
    let mass = 0;
    for (let quadrant = 0; quadrant < QUADRANTS; quadrant += 1) {
      const start = this.quadrantBounds[boundsBase + quadrant]!;
      const end = this.quadrantBounds[boundsBase + quadrant + 1]!;
      if (end <= start) continue;
      const childX = cx + ((quadrant & 1) === 0 ? -quarter : quarter);
      const childY = cy + ((quadrant & 2) === 0 ? -quarter : quarter);
      const child = this.subdivide(x, y, start, end, childX, childY, quarter, depth + 1);
      if (child < 0) continue;
      this.childCells[childBase + quadrant] = child;
      const childMass = this.mass[child]!;
      sumX += this.centreX[child]! * childMass;
      sumY += this.centreY[child]! * childMass;
      mass += childMass;
    }

    this.mass[cell] = mass;
    this.centreX[cell] = mass === 0 ? cx : sumX / mass;
    this.centreY[cell] = mass === 0 ? cy : sumY / mass;
    return cell;
  }

  /**
   * Counting sort of `order[lo, hi)` into the four quadrants around (cx, cy), writing the
   * five run boundaries into `quadrantBounds` for this depth level.
   */
  private partition(
    x: Float64Array,
    y: Float64Array,
    lo: number,
    hi: number,
    cx: number,
    cy: number,
    depth: number,
  ): void {
    const countBase = depth * QUADRANTS;
    const boundsBase = depth * (QUADRANTS + 1);
    for (let quadrant = 0; quadrant < QUADRANTS; quadrant += 1) {
      this.quadrantCounts[countBase + quadrant] = 0;
    }
    for (let slot = lo; slot < hi; slot += 1) {
      const bucket = countBase + quadrantOf(x, y, this.order[slot]!, cx, cy);
      this.quadrantCounts[bucket] = this.quadrantCounts[bucket]! + 1;
    }
    let cursor = lo;
    for (let quadrant = 0; quadrant < QUADRANTS; quadrant += 1) {
      this.quadrantBounds[boundsBase + quadrant] = cursor;
      this.quadrantCursors[countBase + quadrant] = cursor;
      cursor += this.quadrantCounts[countBase + quadrant]!;
    }
    this.quadrantBounds[boundsBase + QUADRANTS] = cursor;

    for (let slot = lo; slot < hi; slot += 1) {
      const point = this.order[slot]!;
      const bucket = countBase + quadrantOf(x, y, point, cx, cy);
      this.scratch[this.quadrantCursors[bucket]!] = point;
      this.quadrantCursors[bucket] = this.quadrantCursors[bucket]! + 1;
    }
    for (let slot = lo; slot < hi; slot += 1) {
      this.order[slot] = this.scratch[slot]!;
    }
  }
}

function quadrantOf(
  x: Float64Array,
  y: Float64Array,
  point: number,
  cx: number,
  cy: number,
): number {
  return (x[point]! < cx ? 0 : 1) | (y[point]! < cy ? 0 : 2);
}

/**
 * A stable pseudo-random direction for a pair of coincident nodes. Keyed on the unordered
 * pair so the push stays equal and opposite, and varies between pairs so a stack of nodes
 * fans out instead of cancelling to zero.
 */
function coincidentAngle(index: number, other: number): number {
  const low = index < other ? index : other;
  const high = index < other ? other : index;
  const mixed = (Math.imul(low + 1, 2654435761) ^ Math.imul(high + 1, 1597334677)) >>> 0;
  return ((mixed % 6283) / 1000);
}
