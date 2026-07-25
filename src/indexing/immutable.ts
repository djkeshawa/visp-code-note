import type { IndexSnapshot } from "../domain/models";

export function freezeSnapshot(snapshot: IndexSnapshot): IndexSnapshot {
  return deepFreeze(snapshot);
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }

  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
}
