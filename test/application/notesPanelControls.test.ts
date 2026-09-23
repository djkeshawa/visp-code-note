import assert = require("node:assert/strict");
import { test } from "node:test";
import { publish, rows, search, type, text, restoreState, savedState } from "../support/notesPanelDom";
import { window } from "../support/domEnvironment";
import type { NotesState } from "../../src/domain/protocol";

restoreState({ listing: "recent", query: "#design", tag: "", sort: "title", compact: true });
require("../../src/webview/notes");

const state: NotesState = {
  listing: { kind: "recent" }, indexedAt: 1,
  rows: [
    { uri: "file:///z.md", title: "Zebra", path: "research/z.md", tags: ["design"], modifiedAt: 10 },
    { uri: "file:///a.md", title: "Alpha", path: "projects/a.md", tags: ["design", "work"], modifiedAt: 5 },
    { uri: "file:///b.md", title: "Beta", path: "projects/b.md", tags: ["work"], modifiedAt: 2 },
  ],
};

function select(id: string, value: string): void {
  const element = window.document.querySelector<HTMLSelectElement>(id);
  assert.ok(element);
  element.value = value;
  element.dispatchEvent(new window.Event("change"));
}

test("restores note search, sort, and density when the webview reloads", () => {
  publish(state);
  assert.equal(search().value, "#design");
  assert.deepEqual(rows().map((row) => row.querySelector(".note-row-title")?.textContent), ["Alpha", "Zebra"]);
  assert.equal(window.document.querySelector("#note-density")?.getAttribute("aria-pressed"), "true");
  assert.ok(window.document.querySelector("#note-rows.is-compact"));
});

test("combines a tag filter with search and saves the current controls", () => {
  type("projects");
  select("#note-tag", "design");
  assert.equal(rows().length, 1);
  assert.equal(rows()[0]?.querySelector(".note-row-title")?.textContent, "Alpha");
  assert.match(text("#note-count"), /1 of 3 shown/);
  assert.deepEqual(savedState, { listing: "recent", query: "projects", tag: "design", sort: "title", compact: true });
});

test("clearing an empty search restores the list and returns focus to search", () => {
  type("no such note");
  assert.equal(rows().length, 0);
  const reset = window.document.querySelector<HTMLButtonElement>(".empty-state-action");
  assert.ok(reset);
  reset.click();
  assert.equal(rows().length, 3);
  assert.equal(window.document.activeElement, search());
  assert.equal(window.document.querySelector<HTMLButtonElement>("#note-clear")?.hidden, true);
});

test("index updates preserve filters, but a different listing clears them", () => {
  type("zebra");
  publish(state);
  assert.equal(rows().length, 1);
  publish({ ...state, listing: { kind: "tag", tag: "work" } });
  assert.equal(search().value, "");
  assert.equal(rows().length, 3);
});

test("malformed optional fields do not crash or replace the current list", () => {
  publish(state);
  for (const invalid of [{ tags: [42] }, { detail: {} }, { modifiedAt: Infinity }, { modifiedAt: 9e15 }, { start: -1 }]) {
    window.dispatchEvent(new window.MessageEvent("message", { data: {
      type: "notes/state", state: { ...state, rows: [{ ...state.rows[0], ...invalid }] },
    } }));
    assert.equal(rows().length, 3);
  }
});
