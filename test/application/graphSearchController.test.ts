import assert = require("node:assert/strict");
import { afterEach, beforeEach, test } from "node:test";
import { window } from "../support/domEnvironment";
import { setWebviewFocused } from "../support/webviewFocus";
import { GRAPH_BODY } from "../../src/ui/pageBodies";
import { GraphSearchController } from "../../src/webview/graph/searchController";
import type { GraphToHostWire } from "../../src/webview/contracts";

let controller: GraphSearchController;
let sent: GraphToHostWire[];
let selected: string[];
let changes: number;
const graph = { nodes: [{ id: "a", kind: "note" as const, label: "Alpha", uri: "file:///a.md" },
  { id: "b", kind: "note" as const, label: "Beta", uri: "file:///b.md" }], edges: [] };

beforeEach(() => {
  setWebviewFocused(true);
  window.document.body.innerHTML = GRAPH_BODY;
  sent = [];
  selected = [];
  changes = 0;
  controller = new GraphSearchController({ send: (message) => sent.push(message), save: () => {},
    changed: () => { changes += 1; controller.setSelection(selected.at(-1)); },
    select: (id) => { selected.push(id); controller.setSelection(id); } });
  controller.setContext(1, graph, ["note"], true);
});
afterEach(() => controller.dispose());

function input(text: string): void {
  const search = window.document.querySelector<HTMLInputElement>("#graph-search")!;
  search.value = text;
  search.dispatchEvent(new window.Event("input"));
}
async function request() {
  await new Promise((resolve) => setTimeout(resolve, 180));
  const message = sent.at(-1);
  assert.ok(message?.type === "graph/search");
  return message;
}
function response(requestId: number, revision = 1) {
  return { type: "graph/searchResults", requestId, revision, nodeIds: ["a", "b"], results: [{
    nodeId: "a", matchedField: "body", preview: "<img src=x onerror=alert(1)>", uri: "file:///a.md", start: 23,
  }] };
}

test("rapid typing sends one query and stale replies cannot replace newer results", async () => {
  input("a"); input("al"); input("alpha");
  const first = await request();
  assert.equal(sent.length, 1);
  assert.equal(first.query, "alpha");
  input("beta");
  assert.equal(controller.accept(response(first.requestId)), false);
  const second = await request();
  assert.equal(controller.accept(response(second.requestId)), true);
  assert.deepEqual(controller.matches, ["a", "b"]);
});

test("a graph revision invalidates in-flight search responses", async () => {
  input("alpha"); const first = await request();
  controller.setContext(2, graph, ["note"], false);
  assert.equal(controller.accept(response(first.requestId)), false);
  const second = await request();
  assert.equal(second.revision, 2);
  assert.equal(second.includeOrphans, false);
  assert.equal(controller.accept(response(second.requestId, 1)), false);
  assert.equal(controller.accept(response(second.requestId, 2)), true);
});

test("clearing search cancels pending requests and hides results", async () => {
  input("alpha");
  window.document.querySelector<HTMLButtonElement>("#graph-search-clear")!.click();
  await new Promise((resolve) => setTimeout(resolve, 180));
  assert.equal(sent.length, 0);
  assert.equal(controller.pending, false);
  assert.equal(window.document.querySelector<HTMLElement>("#graph-search-panel")!.hidden, true);
});

test("result snippets render as text, and opening a match sends its exact location", async () => {
  input("alpha"); const query = await request();
  controller.accept(response(query.requestId));
  assert.equal(window.document.querySelector("#graph-search-results img"), null);
  assert.match(window.document.querySelector(".graph-result-preview")!.textContent, /<img/);
  window.document.querySelector<HTMLButtonElement>(".graph-result-open")!.click();
  assert.deepEqual(sent.at(-1), { type: "graph/open", uri: "file:///a.md", start: 23 });
  window.document.querySelector<HTMLButtonElement>("#graph-match-next")!.click();
  window.document.querySelector<HTMLButtonElement>("#graph-match-next")!.click();
  assert.deepEqual(selected, ["a", "b"], "navigation includes matches beyond the displayed result cap");
});

test("search errors retain a visible failure state through a selection refresh", async () => {
  input("alpha"); const query = await request();
  controller.accept({ type: "graph/error", requestId: query.requestId, revision: 1, message: "Index unavailable" });
  assert.equal(window.document.querySelector("#graph-search-status")!.textContent, "Search failed");
  assert.match(window.document.querySelector(".empty-state-message")!.textContent, /Index unavailable/);
});


test("refreshing search results after typing in another editor does not steal focus", async () => {
  input("alpha");
  const first = await request();
  controller.accept(response(first.requestId));
  window.document.querySelector<HTMLButtonElement>(".graph-result-select")!.focus();
  setWebviewFocused(false);
  controller.setContext(2, graph, ["note"], true);
  const next = await request();
  controller.accept(response(next.requestId, 2));
  assert.equal(window.document.activeElement, window.document.body, "search results reclaimed focus from the note");
});

test("an index update that finds the same matches keeps them on screen and leaves the graph alone", async () => {
  input("alpha");
  const first = await request();
  controller.accept(response(first.requestId));
  const before = changes;
  controller.setContext(2, graph, ["note"], true);
  assert.deepEqual(controller.matches, ["a", "b"], "matches were dropped while the refresh was in flight");
  assert.equal(controller.pending, false);
  assert.ok(window.document.querySelector(".graph-result"), "results were replaced by a loading state");
  const next = await request();
  controller.accept(response(next.requestId, 2));
  assert.equal(changes, before, "an unchanged result set redrew the graph");
});

test("a repeated context with nothing new does not search again", async () => {
  input("alpha");
  const first = await request();
  controller.accept(response(first.requestId));
  const count = sent.length;
  controller.setContext(1, graph, ["note"], true);
  await new Promise((resolve) => setTimeout(resolve, 180));
  assert.equal(sent.length, count);
});

test("typing over settled results keeps them until the new ones arrive", async () => {
  input("alpha");
  const first = await request();
  controller.accept(response(first.requestId));
  input("alph");
  assert.deepEqual(controller.matches, ["a", "b"]);
  const next = await request();
  controller.accept({ ...response(next.requestId), nodeIds: ["a"] });
  assert.deepEqual(controller.matches, ["a"]);
  assert.equal(window.document.querySelector("#graph-search-results")!.hasAttribute("aria-busy"), false);
});
