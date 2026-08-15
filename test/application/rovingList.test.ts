import assert = require("node:assert/strict");
import { test } from "node:test";
import { nextRowIndex } from "../../src/webview/shared/rovingList";

test("the arrows step one row at a time", () => {
  assert.equal(nextRowIndex("ArrowDown", 0, 5), 1);
  assert.equal(nextRowIndex("ArrowUp", 3, 5), 2);
});

test("Home and End reach the ends in one press", () => {
  assert.equal(nextRowIndex("Home", 4, 5), 0);
  assert.equal(nextRowIndex("End", 0, 5), 4);
});

/*
 * A four-item menu can wrap harmlessly; a list of several hundred notes cannot. Holding
 * ArrowDown would teleport the reader back to the top of a list they were working down.
 */
test("the ends hold rather than wrapping around", () => {
  assert.equal(nextRowIndex("ArrowDown", 4, 5), 4);
  assert.equal(nextRowIndex("ArrowUp", 0, 5), 0);
});

test("a key that is not a move says so, so the list leaves it for the row", () => {
  assert.equal(nextRowIndex("Enter", 0, 5), undefined);
  assert.equal(nextRowIndex("ArrowRight", 0, 5), undefined);
  assert.equal(nextRowIndex("a", 0, 5), undefined);
});

test("an empty list has nowhere to move to", () => {
  assert.equal(nextRowIndex("ArrowDown", 0, 0), undefined);
  assert.equal(nextRowIndex("Home", 0, 0), undefined);
});
