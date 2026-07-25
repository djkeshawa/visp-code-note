export interface GraphPoint {
  readonly x: number;
  readonly y: number;
}

export interface GraphExtent {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface GraphViewport {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export const DEFAULT_GRAPH_VIEWPORT: GraphViewport = Object.freeze({
  x: 0,
  y: 0,
  width: 960,
  height: 640,
});

const MIN_VIEWPORT_WIDTH = 120;
const MAX_VIEWPORT_WIDTH = 7_680;
const MIN_FITTED_WIDTH = DEFAULT_GRAPH_VIEWPORT.width / 2;

export function zoomViewport(
  viewport: GraphViewport,
  anchor: GraphPoint,
  factor: number,
): GraphViewport {
  if (!Number.isFinite(factor) || factor <= 0) return viewport;
  const width = clamp(viewport.width / factor, MIN_VIEWPORT_WIDTH, MAX_VIEWPORT_WIDTH);
  const ratio = width / viewport.width;
  const height = viewport.height * ratio;
  const anchorX = (anchor.x - viewport.x) / viewport.width;
  const anchorY = (anchor.y - viewport.y) / viewport.height;
  return {
    x: anchor.x - anchorX * width,
    y: anchor.y - anchorY * height,
    width,
    height,
  };
}

export function panViewport(viewport: GraphViewport, delta: GraphPoint): GraphViewport {
  return { ...viewport, x: viewport.x + delta.x, y: viewport.y + delta.y };
}

export function centerViewport(viewport: GraphViewport, point: GraphPoint): GraphViewport {
  return {
    ...viewport,
    x: point.x - viewport.width / 2,
    y: point.y - viewport.height / 2,
  };
}

export function fitViewport(
  extent: GraphExtent,
  aspectRatio = DEFAULT_GRAPH_VIEWPORT.width / DEFAULT_GRAPH_VIEWPORT.height,
  padding = 24,
): GraphViewport {
  const contentWidth = Math.max(1, extent.maxX - extent.minX) + padding * 2;
  const contentHeight = Math.max(1, extent.maxY - extent.minY) + padding * 2;
  const ratio = Number.isFinite(aspectRatio) && aspectRatio > 0
    ? aspectRatio
    : DEFAULT_GRAPH_VIEWPORT.width / DEFAULT_GRAPH_VIEWPORT.height;
  const fittedWidth = Math.max(MIN_FITTED_WIDTH, contentWidth, contentHeight * ratio);
  const fittedHeight = fittedWidth / ratio;
  const center = {
    x: (extent.minX + extent.maxX) / 2,
    y: (extent.minY + extent.maxY) / 2,
  };
  return clampViewportSize({
    x: center.x - fittedWidth / 2,
    y: center.y - fittedHeight / 2,
    width: fittedWidth,
    height: fittedHeight,
  }, center);
}

export function viewportZoomPercent(viewport: GraphViewport): number {
  return Math.round((DEFAULT_GRAPH_VIEWPORT.width / viewport.width) * 100);
}

function clampViewportSize(viewport: GraphViewport, center: GraphPoint): GraphViewport {
  const width = clamp(viewport.width, MIN_VIEWPORT_WIDTH, MAX_VIEWPORT_WIDTH);
  if (width === viewport.width) return viewport;
  const height = viewport.height * (width / viewport.width);
  return {
    x: center.x - width / 2,
    y: center.y - height / 2,
    width,
    height,
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
