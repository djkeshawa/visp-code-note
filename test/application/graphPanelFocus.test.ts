import assert = require("node:assert/strict");
import { after, beforeEach, test } from "node:test";
import { publish, node, nextFrame } from "../support/graphPanelDom";
import "../../src/webview/graph";
import { window } from "../support/domEnvironment";
import { setWebviewFocused } from "../support/webviewFocus";

beforeEach(async () => {
  setWebviewFocused(true);
  document.querySelector<HTMLInputElement>("#graph-search")!.focus();
  publish();
  node().dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await nextFrame();
});
after(() => window.dispatchEvent(new window.Event("unload")));

test("a focused graph node survives an index update", async () => {
  node().focus();
  publish();
  await nextFrame();
  assert.equal(document.activeElement, node());
});

test("an index update cannot focus a graph left open in the background", async () => {
  node().focus();
  setWebviewFocused(false);
  publish();
  await nextFrame();
  assert.notEqual(document.activeElement, node());
});

test("leaving the graph before its scheduled restoration cancels the focus move", async () => {
  node().focus();
  publish();
  setWebviewFocused(false);
  await nextFrame();
  assert.notEqual(document.activeElement, node());
});

test("typing in graph search before a repaint finishes keeps focus in search", async () => {
  node().focus();
  publish();
  const search = document.querySelector<HTMLInputElement>("#graph-search")!;
  search.focus();
  await nextFrame();
  assert.equal(document.activeElement, search);
});

test("a background graph does not reclaim a connection row", async () => {
  document.querySelector<HTMLButtonElement>("#selected-connections [data-node-id]")!.focus();
  setWebviewFocused(false);
  publish();
  await nextFrame();
  assert.equal(document.activeElement, document.body);
});
