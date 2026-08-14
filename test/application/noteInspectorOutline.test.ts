import assert = require("node:assert/strict");
import { test } from "node:test";
// Must come first: the inspector builds real elements, so it needs a real document.
import { window } from "../support/domEnvironment";
import { EDITOR_BODY } from "../../src/ui/pageBodies";
import {
  getNoteInspectorElements,
  markCurrentOutlineEntry,
  renderNoteInspector,
} from "../../src/webview/editor/noteInspector.js";
import type { NoteInspectorElements } from "../../src/webview/editor/noteInspector.js";

/**
 * The outline as a place rather than as a jump list.
 *
 * Fifty headings drawn as fifty identical buttons say where you could go and nothing about
 * where you are, which is the one thing the reader already knows and the panel does not.
 */

const NOTE = [
  "# Atlas",
  "",
  "Opening prose.",
  "",
  "## Sources",
  "",
  "Some prose about sources.",
  "",
  "## Method",
  "",
  "The method itself. ^method-anchor",
  "",
  "## Findings",
  "",
  "What was found.",
].join("\n");

function openInspector(source: string = NOTE): NoteInspectorElements {
  window.document.body.innerHTML = EDITOR_BODY;
  const elements = getNoteInspectorElements();
  renderNoteInspector(elements, source, undefined, {
    reveal: () => undefined,
    openBacklink: () => undefined,
    toggleTask: () => undefined,
    openLink: () => undefined,
  });
  return elements;
}

/** The label of the entry drawn as the one the caret is in, if any. */
function currentLabel(elements: NoteInspectorElements): string | undefined {
  return elements.outline.querySelector(".is-current")?.textContent ?? undefined;
}

test("the outline says which section the caret is in", () => {
  const elements = openInspector();
  assert.equal(currentLabel(elements), undefined, "nothing is current before the caret is known");

  markCurrentOutlineEntry(elements, NOTE.indexOf("Some prose about sources"));
  assert.equal(currentLabel(elements), "Sources");

  markCurrentOutlineEntry(elements, NOTE.indexOf("What was found"));
  assert.equal(currentLabel(elements), "Findings");
});

test("only one entry is current at a time", () => {
  const elements = openInspector();
  markCurrentOutlineEntry(elements, NOTE.indexOf("## Sources"));
  markCurrentOutlineEntry(elements, NOTE.indexOf("## Findings"));

  assert.equal(elements.outline.querySelectorAll(".is-current").length, 1);
});

test("the caret on a heading line is inside that heading's own section", () => {
  const elements = openInspector();
  markCurrentOutlineEntry(elements, NOTE.indexOf("Some prose about sources"));
  markCurrentOutlineEntry(elements, NOTE.indexOf("## Method") + 3);

  assert.equal(currentLabel(elements), "Method");
});

test("prose before the first heading belongs to no section", () => {
  const source = "Loose prose above everything.\n\n# Later heading\n";
  const elements = openInspector(source);
  markCurrentOutlineEntry(elements, source.indexOf("above"));

  assert.equal(currentLabel(elements), undefined);
});

test("a block anchor is a place the caret can be in, like a heading", () => {
  const elements = openInspector();
  markCurrentOutlineEntry(elements, NOTE.indexOf("^method-anchor") + 2);

  assert.equal(currentLabel(elements), "^method-anchor");
});

test("the caret survives the outline being redrawn while typing", () => {
  const elements = openInspector();
  markCurrentOutlineEntry(elements, NOTE.indexOf("What was found"));
  renderNoteInspector(elements, NOTE, undefined, {
    reveal: () => undefined,
    openBacklink: () => undefined,
    toggleTask: () => undefined,
    openLink: () => undefined,
  });

  assert.equal(currentLabel(elements), undefined, "a fresh outline knows nothing yet");
  markCurrentOutlineEntry(elements, NOTE.indexOf("What was found"));
  assert.equal(currentLabel(elements), "Findings", "and takes the caret back when told");
});
