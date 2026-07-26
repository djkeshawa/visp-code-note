/**
 * Graph layout benchmark. Not part of `npm test` — run it directly:
 *
 *   npm run compile:test && node out-tests/test/benchmarks/graphPerformance.bench.js
 *
 * It reports two things per workspace size:
 *
 *   - cost: milliseconds for the initial settle and per live-simulation tick;
 *   - quality: how many node pairs end up overlapping, and the nearest-neighbour
 *     spacing. A layout can be fast and still be wrong, so speed alone is not enough.
 */

import type { GraphDataWire, GraphEdgeWire, GraphNodeWire } from "../../src/webview/contracts";
import { graphLayoutBounds, layoutGraph } from "../../src/webview/graph/layout";
import type { GraphBounds, GraphPoint } from "../../src/webview/graph/layout";
import { LiveForceSimulation } from "../../src/webview/graph/liveForceSimulation";
import { nodeDegrees, nodeRadius } from "../../src/webview/graph/metrics";

/** Bounds come from the product's own sizing rule, not a fixed canvas. */
const bounds = (nodeCount: number): GraphBounds => graphLayoutBounds(nodeCount);
const MAX_TICKS = 400;

interface Scenario {
  readonly label: string;
  readonly notes: number;
}

const SCENARIOS: readonly Scenario[] = [
  { label: "small vault", notes: 60 },
  { label: "medium vault", notes: 250 },
  { label: "large vault", notes: 1000 },
  { label: "very large vault", notes: 2500 },
];

/**
 * A deterministic workspace-shaped graph: notes gathered into folders, most links
 * staying inside a folder, a few crossing between them, plus tasks and tags. Seeded so
 * every run compares like with like.
 */
function buildScenarioGraph(notes: number): GraphDataWire {
  const random = seededRandom(20260726);
  const nodes: GraphNodeWire[] = [];
  const edges: GraphEdgeWire[] = [];
  const folderCount = Math.max(1, Math.round(notes / 25));

  for (let index = 0; index < notes; index += 1) {
    nodes.push({
      id: `note:${index}`,
      label: `Note ${index}`,
      kind: "note",
      uri: `file:///notes/f${index % folderCount}/note-${index}.md`,
    });
  }

  const linkTarget = (from: number): number => {
    const folder = from % folderCount;
    if (random() < 0.15) return Math.floor(random() * notes);
    const candidate = folder + folderCount * Math.floor(random() * Math.ceil(notes / folderCount));
    return candidate < notes ? candidate : from;
  };

  for (let from = 0; from < notes; from += 1) {
    const outgoing = 1 + Math.floor(random() * 3);
    for (let link = 0; link < outgoing; link += 1) {
      const to = linkTarget(from);
      if (to !== from) {
        edges.push({ id: `link:${from}->${to}:${link}`, source: `note:${from}`, target: `note:${to}`, kind: "link" });
      }
    }
  }

  // One task on roughly a third of the notes, and eight tags spread across the vault.
  for (let index = 0; index < notes; index += 3) {
    const id = `task:${index}`;
    nodes.push({ id, label: `Task ${index}`, kind: "task", uri: `file:///notes/note-${index}.md` });
    edges.push({ id: `task-edge:${index}`, source: `note:${index}`, target: id, kind: "task" });
  }
  for (let tag = 0; tag < 8; tag += 1) {
    nodes.push({ id: `tag:${tag}`, label: `#tag${tag}`, kind: "tag" });
  }
  for (let index = 0; index < notes; index += 1) {
    if (index % 4 !== 0) continue;
    edges.push({
      id: `tag-edge:${index}`,
      source: `note:${index}`,
      target: `tag:${index % 8}`,
      kind: "tag",
    });
  }

  return { nodes, edges, focusId: `note:0` };
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function radiusById(graph: GraphDataWire): ReadonlyMap<string, number> {
  const degrees = nodeDegrees(graph);
  return new Map(
    graph.nodes.map((node) => [
      node.id,
      Math.max(10, nodeRadius(node, degrees.get(node.id) ?? 0, graph.focusId === node.id) + 5),
    ]),
  );
}

interface Quality {
  readonly overlappingPairs: number;
  readonly medianNearestNeighbour: number;
  readonly spread: number;
}

/**
 * Overlap and nearest-neighbour distance are measured with an exact all-pairs sweep on a
 * capped sample, so the measurement itself never depends on the approximation under test.
 */
function measureQuality(
  graph: GraphDataWire,
  positions: ReadonlyMap<string, GraphPoint>,
): Quality {
  const radii = radiusById(graph);
  const points = graph.nodes
    .flatMap((node) => {
      const point = positions.get(node.id);
      return point === undefined ? [] : [{ id: node.id, ...point, r: radii.get(node.id) ?? 10 }];
    })
    .slice(0, 1200);

  let overlappingPairs = 0;
  const nearest: number[] = [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let left = 0; left < points.length; left += 1) {
    const a = points[left]!;
    minX = Math.min(minX, a.x);
    maxX = Math.max(maxX, a.x);
    minY = Math.min(minY, a.y);
    maxY = Math.max(maxY, a.y);
    let closest = Infinity;
    for (let right = 0; right < points.length; right += 1) {
      if (left === right) continue;
      const b = points[right]!;
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      closest = Math.min(closest, distance);
      if (right > left && distance < a.r + b.r) overlappingPairs += 1;
    }
    if (Number.isFinite(closest)) nearest.push(closest);
  }
  nearest.sort((left, right) => left - right);
  return {
    overlappingPairs,
    medianNearestNeighbour: nearest[Math.floor(nearest.length / 2)] ?? 0,
    spread: Math.round(Math.max(maxX - minX, maxY - minY)),
  };
}

function milliseconds(run: () => void): number {
  const started = process.hrtime.bigint();
  run();
  return Number(process.hrtime.bigint() - started) / 1e6;
}

function report(): void {
  const rows: string[][] = [[
    "scenario", "nodes", "edges", "settle ms", "tick ms", "ticks", "overlaps", "median gap", "spread",
  ]];

  for (const scenario of SCENARIOS) {
    const graph = buildScenarioGraph(scenario.notes);
    let positions: ReadonlyMap<string, GraphPoint> = new Map();
    const BOUNDS = bounds(graph.nodes.length);
    const settleMs = milliseconds(() => {
      positions = layoutGraph(graph, BOUNDS);
    });

    // Run until the simulation cools, so quality is measured on the layout the user ends
    // up looking at rather than on a frame caught mid-flight.
    const simulation = new LiveForceSimulation(graph, positions, BOUNDS);
    let live: ReadonlyMap<string, GraphPoint> = positions;
    let ticks = 0;
    const liveMs = milliseconds(() => {
      let active = true;
      while (active && ticks < MAX_TICKS) {
        const frame = simulation.tick();
        live = frame.positions;
        active = frame.active;
        ticks += 1;
      }
    });

    const quality = measureQuality(graph, live);
    rows.push([
      scenario.label,
      String(graph.nodes.length),
      String(graph.edges.length),
      settleMs.toFixed(1),
      (liveMs / Math.max(1, ticks)).toFixed(2),
      String(ticks),
      String(quality.overlappingPairs),
      quality.medianNearestNeighbour.toFixed(1),
      String(quality.spread),
    ]);
  }

  const widths = rows[0]!.map((_, column) =>
    Math.max(...rows.map((row) => row[column]!.length)));
  for (const [index, row] of rows.entries()) {
    // eslint-disable-next-line no-console
    console.log(row.map((cell, column) => cell.padEnd(widths[column]!)).join("  "));
    if (index === 0) {
      // eslint-disable-next-line no-console
      console.log(widths.map((width) => "-".repeat(width)).join("  "));
    }
  }
}

report();
