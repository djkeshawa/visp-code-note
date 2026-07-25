import assert = require("node:assert/strict");
import { test } from "node:test";
import { wikiLinkDisplayRange } from "../../src/webview/editor/wikiLinkPresentation";

test("selects only the readable alias for inactive live links", () => {
  const raw = "[[Target#Heading|  Readable label  ]]";
  const range = wikiLinkDisplayRange(raw, true);

  assert.ok(range !== undefined);
  assert.equal(raw.slice(range.start, range.end), "Readable label");
  assert.deepEqual(wikiLinkDisplayRange("[[  Target  ]]", false), { start: 4, end: 10 });
  assert.deepEqual(wikiLinkDisplayRange("[[Target|   ]]", false), { start: 2, end: 8 });
});
