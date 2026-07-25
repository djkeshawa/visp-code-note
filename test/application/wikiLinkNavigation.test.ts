import assert = require("node:assert/strict");
import { test } from "node:test";
import { findWikiLinkAtPosition } from "../../src/webview/editor/wikiLinkNavigation";

test("finds a wiki link at either cursor edge and rejects adjacent positions", () => {
  const line = "A [[Target]] B";
  const expected = {
    from: 2,
    to: 12,
    raw: "[[Target]]",
    target: "Target",
  };

  assert.deepEqual(findWikiLinkAtPosition(line, 2), expected);
  assert.deepEqual(findWikiLinkAtPosition(line, 7), expected);
  assert.deepEqual(findWikiLinkAtPosition(line, 12), expected);
  assert.equal(findWikiLinkAtPosition(line, 1), undefined);
  assert.equal(findWikiLinkAtPosition(line, 13), undefined);
});

test("opens an aliased wiki link by its trimmed target", () => {
  const line = "[[  Architecture#Runtime | lifecycle details  ]]";

  assert.deepEqual(findWikiLinkAtPosition(line, 20), {
    from: 0,
    to: line.length,
    raw: line,
    target: "Architecture#Runtime",
  });
  assert.equal(findWikiLinkAtPosition("[[]]", 2), undefined);
  assert.equal(findWikiLinkAtPosition("[[  | label ]]", 4), undefined);
});

test("uses the first pipe as the alias separator, matching the Markdown parser", () => {
  assert.equal(
    findWikiLinkAtPosition(String.raw`[[Folder\|Name|label]]`, 8)?.target,
    "Folder\\",
  );
  assert.equal(
    findWikiLinkAtPosition(String.raw`[[Folder\\|label]]`, 8)?.target,
    String.raw`Folder\\`,
  );
});

test("ignores escaped wiki-link openers and accepts even escape runs", () => {
  const escaped = String.raw`\[[Literal]] and [[Target]]`;
  assert.equal(findWikiLinkAtPosition(escaped, 5), undefined);
  assert.equal(findWikiLinkAtPosition(escaped, 22)?.target, "Target");

  const unescaped = String.raw`\\[[Target]]`;
  assert.equal(findWikiLinkAtPosition(unescaped, 5)?.target, "Target");
});
