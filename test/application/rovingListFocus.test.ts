import assert = require("node:assert/strict");
import { afterEach, test } from "node:test";
import { window } from "../support/domEnvironment";
import { setWebviewFocused } from "../support/webviewFocus";
import { RovingList } from "../../src/webview/shared/rovingList";

afterEach(() => { setWebviewFocused(true); window.document.body.replaceChildren(); });

function list() {
  const container = document.createElement("div");
  document.body.append(container);
  const navigation = new RovingList(container, { rows: "button" });
  const render = () => {
    const row = document.createElement("button");
    row.textContent = "A note";
    container.replaceChildren(row);
    navigation.refresh();
    return row;
  };
  return { render, first: render() };
}

test("an active list restores its row after an index redraw", () => {
  const { first, render } = list();
  first.focus();
  const replacement = render();
  assert.equal(document.activeElement, replacement);
});

test("a list in another webview cannot reclaim focus during a redraw", () => {
  const { first, render } = list();
  first.focus();
  // A webview can retain its activeElement even after its containing window loses focus.
  setWebviewFocused(false);
  const replacement = render();
  assert.notEqual(document.activeElement, replacement, "the background list stole focus");
  setWebviewFocused(true);
  assert.notEqual(document.activeElement, render(), "an old restoration must not survive returning to the pane");
});

test("a redraw leaves focus on a filter the reader moved to", () => {
  const { first, render } = list();
  first.focus();
  const input = document.createElement("input");
  document.body.append(input);
  input.focus();
  render();
  assert.equal(document.activeElement, input);
});
