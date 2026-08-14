import assert = require("node:assert/strict");
import { test } from "node:test";
import type { GraphNodeWire } from "../../src/webview/contracts";
import { graphFocusAction } from "../../src/webview/graph/focusAction";

const note: GraphNodeWire = { id: "note:b", label: "Architecture", kind: "note", uri: "file:///b.md" };
const task: GraphNodeWire = { id: "task:a:1", label: "Draft it", kind: "task", uri: "file:///a.md" };
const tag: GraphNodeWire = { id: "tag:design", label: "#design", kind: "tag" };

test("offers to draw the graph around any note that is not already the centre", () => {
  const action = graphFocusAction(note, "note:a");

  assert.equal(action.disabled, false);
  assert.equal(action.label, "Focus here");
  assert.match(action.title, /Architecture/);
});

test("a task is focused through the note it was written in", () => {
  const action = graphFocusAction(task, undefined);

  assert.equal(action.disabled, false);
  assert.equal(action.label, "Focus its note");
});

test("a tag is not a note, so it says so instead of offering an empty graph", () => {
  const action = graphFocusAction(tag, undefined);

  assert.equal(action.disabled, true);
  assert.match(action.title, /#design/);
  assert.match(action.title, /not a note/);
});

test("the node already at the centre is not offered a redraw that changes nothing", () => {
  const action = graphFocusAction(note, "note:b");

  assert.equal(action.disabled, true);
  assert.match(action.title, /already the centre/);
});

test("with nothing selected the button waits, disabled, rather than disappearing", () => {
  const action = graphFocusAction(undefined, undefined);

  assert.equal(action.disabled, true);
  assert.equal(action.label, "Focus here");
});
