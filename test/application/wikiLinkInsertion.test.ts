import assert = require("node:assert/strict");
import { test } from "node:test";
import { planWikiLinkInsertion } from "../../src/webview/editor/wikiLinkInsertion";

test("preserves a selected label as the wiki-link alias", () => {
  assert.deepEqual(planWikiLinkInsertion("Architecture", "system design"), {
    source: "[[Architecture|system design]]",
  });
  assert.deepEqual(planWikiLinkInsertion("Architecture", ""), {
    source: "[[Architecture]]",
  });
});

test("rejects unsupported aliases without producing replacement text", () => {
  for (const selection of ["one|two", "one]two", "one]]two", "one\ntwo", "one\rtwo"]) {
    const plan = planWikiLinkInsertion("Architecture", selection);
    assert.ok("error" in plan);
    assert.match(plan.error, /left unchanged/);
  }
});
