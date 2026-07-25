import type { GraphPoint } from "./layout.js";

export function clientPointToSvg(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
): GraphPoint {
  const matrix = svg.getScreenCTM();
  if (matrix !== null) {
    try {
      const point = svg.createSVGPoint();
      point.x = clientX;
      point.y = clientY;
      const transformed = point.matrixTransform(matrix.inverse());
      return { x: transformed.x, y: transformed.y };
    } catch {
      // Fall through while the SVG is being resized.
    }
  }
  const bounds = svg.getBoundingClientRect();
  const viewBox = svg.viewBox.baseVal;
  return {
    x: viewBox.x + ((clientX - bounds.left) / Math.max(1, bounds.width)) * viewBox.width,
    y: viewBox.y + ((clientY - bounds.top) / Math.max(1, bounds.height)) * viewBox.height,
  };
}
