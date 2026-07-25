import type { GraphPoint } from "./viewportModel.js";

export function findSpatialNodeId(
  positions: ReadonlyMap<string, GraphPoint>,
  currentId: string,
  key: string,
): string | undefined {
  const origin = positions.get(currentId);
  const direction = directionForKey(key);
  if (origin === undefined || direction === undefined) return undefined;

  let best: { readonly id: string; readonly score: number } | undefined;
  for (const [id, point] of positions) {
    if (id === currentId) continue;
    const deltaX = point.x - origin.x;
    const deltaY = point.y - origin.y;
    const forward = deltaX * direction.x + deltaY * direction.y;
    if (forward <= 0) continue;
    const perpendicular = Math.abs(deltaX * direction.y - deltaY * direction.x);
    const score = forward + perpendicular * 2;
    if (best === undefined || score < best.score || (score === best.score && id < best.id)) {
      best = { id, score };
    }
  }
  return best?.id;
}

function directionForKey(key: string): GraphPoint | undefined {
  switch (key) {
    case "ArrowRight":
      return { x: 1, y: 0 };
    case "ArrowLeft":
      return { x: -1, y: 0 };
    case "ArrowDown":
      return { x: 0, y: 1 };
    case "ArrowUp":
      return { x: 0, y: -1 };
    default:
      return undefined;
  }
}
