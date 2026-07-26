import assert = require("node:assert/strict");
import { test } from "node:test";
import {
  DEFAULT_EDITOR_CONTENT_WIDTH,
  editorContentWidthFromState,
  parseEditorContentWidth,
  stateWithEditorContentWidth,
} from "../../src/webview/editor/contentWidth";

test("uses a readable measure by default and rejects unsupported persisted values", () => {
  assert.equal(DEFAULT_EDITOR_CONTENT_WIDTH, "readable");
  assert.equal(parseEditorContentWidth(undefined), DEFAULT_EDITOR_CONTENT_WIDTH);
  assert.equal(parseEditorContentWidth("compact"), DEFAULT_EDITOR_CONTENT_WIDTH);
  assert.equal(editorContentWidthFromState({ editorContentWidth: "invalid" }), "readable");
});

test("restores every supported editor content width", () => {
  assert.equal(editorContentWidthFromState({ editorContentWidth: "readable" }), "readable");
  assert.equal(editorContentWidthFromState({ editorContentWidth: "wide" }), "wide");
  assert.equal(editorContentWidthFromState({ editorContentWidth: "full" }), "full");
});

test("persists content width without discarding future webview state", () => {
  assert.deepEqual(
    stateWithEditorContentWidth({ selectedPanel: "outline" }, "full"),
    { selectedPanel: "outline", editorContentWidth: "full" },
  );
  assert.deepEqual(
    stateWithEditorContentWidth(undefined, "readable"),
    { editorContentWidth: "readable" },
  );
});
