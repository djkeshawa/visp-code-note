import assert = require("node:assert/strict");
import { test } from "node:test";
import { graphEmptyState } from "../../src/webview/graph/emptyStates";

test("says nothing while the canvas has nodes on it", () => {
  assert.equal(graphEmptyState(12, 12, false), undefined);
  assert.equal(graphEmptyState(12, 1, true), undefined);
});

test("blames the filters only when there was a graph to filter", () => {
  const state = graphEmptyState(12, 0, false);

  assert.equal(state?.message, "No nodes match these filters.");
  assert.equal(state?.hint, "Re-enable a type above, or turn orphan notes back on.");
});

test("a matches-only search that found nothing blames the search, not the chips", () => {
  const state = graphEmptyState(12, 0, false, true);

  assert.match(state?.message ?? "", /search/i);
  assert.match(state?.hint ?? "", /Matches only/);
  // The filter wording would have sent the reader to chips that are all still switched on.
  assert.notEqual(state?.message, graphEmptyState(12, 0, false)?.message);
});

test("an empty index names itself instead of sending the reader to the filters", () => {
  const state = graphEmptyState(0, 0, false);

  assert.notEqual(state, undefined);
  assert.doesNotMatch(state!.message, /filter/i);
  assert.doesNotMatch(state!.hint ?? "", /filter/i);
  assert.match(state!.hint ?? "", /note|index/i);
});

test("a local graph with nothing in it points at the index, not at writing more notes", () => {
  const state = graphEmptyState(0, 0, true);

  assert.notEqual(state?.message, graphEmptyState(0, 0, false)?.message);
  assert.match(state!.hint ?? "", /index/i);
});
