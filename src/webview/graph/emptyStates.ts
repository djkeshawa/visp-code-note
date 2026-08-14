export interface GraphEmptyState {
  readonly icon: string;
  readonly message: string;
  readonly hint?: string;
}

/**
 * What the canvas says when it has drawn nothing.
 *
 * A graph with no nodes has more than one cause, and the filter wording fits only one of them:
 * on a workspace holding no Markdown at all it told the reader to re-enable a filter that was
 * never turned off. The whole-graph count separates the two — nothing indexed, or filters that
 * emptied something. Returns nothing when there is a graph on screen, because then the canvas
 * has no message to carry.
 */
export function graphEmptyState(
  totalNodes: number,
  visibleNodes: number,
  isLocalScope: boolean,
  restrictedToMatches = false,
): GraphEmptyState | undefined {
  if (visibleNodes > 0) return undefined;
  /*
   * Asked first, because a matches-only search that found nothing is the one cause the
   * filter wording gets wrong in the most annoying way: it sends the reader to the chips
   * above, which are all still on, while the thing that emptied the canvas is what they
   * just typed.
   */
  if (restrictedToMatches) {
    return {
      icon: "search",
      message: "Nothing on the canvas matches that search.",
      hint: "Try fewer letters, or turn Matches only off to see the graph again.",
    };
  }
  if (totalNodes > 0) {
    return {
      icon: "filter",
      message: "No nodes match these filters.",
      hint: "Re-enable a type above, or turn orphan notes back on.",
    };
  }
  /*
   * A local graph always holds its own note, so an empty one means the index has never seen
   * that note — writing another would not help, and rebuilding might.
   */
  if (isLocalScope) {
    return {
      icon: "note",
      message: "This note is not in the index yet.",
      hint: "Rebuild the index from the graph menu.",
    };
  }
  return {
    icon: "note",
    message: "The graph has nothing to draw yet.",
    hint: "Write a Markdown note, or rebuild the index from the graph menu.",
  };
}
