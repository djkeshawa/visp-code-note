/**
 * How long ago the index was built, in words.
 *
 * Coarse on purpose: the question is whether the index is current, not exactly when it was
 * built, and a value that ticks every second would redraw the panel for nothing.
 */
export function formatIndexedAt(indexedAt: number, now = Date.now()): string | undefined {
  if (indexedAt <= 0) return undefined;
  const seconds = Math.max(0, Math.round((now - indexedAt) / 1000));
  if (seconds < 45) return "indexed just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `indexed ${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `indexed ${hours}h ago`;
  return `indexed ${Math.round(hours / 24)}d ago`;
}
