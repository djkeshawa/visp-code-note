import assert = require("node:assert/strict");
import { test } from "node:test";
import { findWikiQuery, rankSuggestions } from "../../src/webview/editor/wikiSuggestionModel";

test("finds only an open wiki query at a collapsed caret", () => {
  assert.deepEqual(findWikiQuery("Before [[arch", 13, 13), {
    start: 9,
    end: 13,
    query: "arch",
  });
  assert.equal(findWikiQuery("[[closed]]", 10, 10), undefined);
  assert.equal(findWikiQuery("[[two\nlines", 11, 11), undefined);
  assert.equal(findWikiQuery("[[selected", 10, 4), undefined);
  assert.equal(findWikiQuery("\\[[escaped", 11, 11), undefined);
  assert.equal(findWikiQuery("\\\\[[open", 8, 8)?.query, "open");
});

test("ranks prefix and fuzzy note matches across labels, targets, and paths", () => {
  const suggestions = [
    suggestion("Project Atlas", "notes/projects/atlas.md", { aliases: ["Atlas"] }),
    suggestion("Architecture decisions", "notes/architecture.md"),
    suggestion("Release plan", "notes/releases/plan.md"),
  ];
  assert.equal(rankSuggestions(suggestions, "arch")[0]?.label, "Architecture decisions");
  assert.equal(rankSuggestions(suggestions, "pa")[0]?.label, "Project Atlas");
  assert.equal(rankSuggestions(suggestions, "rlpl")[0]?.label, "Release plan");
  assert.equal(rankSuggestions(suggestions, "atlas")[0]?.label, "Project Atlas");
});

test("suggests headings and block IDs for note and local references", () => {
  const current = suggestion("Current", "notes/current.md", {
    referenceTarget: "",
    headings: ["Local section"],
  });
  const architecture = suggestion("Architecture", "notes/architecture.md", {
    headings: ["Indexing", "Runtime model"],
    blockIds: ["parser-block"],
  });
  assert.deepEqual(rankSuggestions([current, architecture], "Architecture#ind")[0], {
    kind: "heading",
    label: "Indexing",
    target: "Architecture#Indexing",
    path: "notes/architecture.md",
  });
  assert.equal(
    rankSuggestions([current, architecture], "Architecture^par")[0]?.target,
    "Architecture^parser-block",
  );
  assert.equal(rankSuggestions([current, architecture], "#loc")[0]?.target, "#Local section");
});

function suggestion(
  label: string,
  path: string,
  overrides: Partial<{
    readonly aliases: readonly string[];
    readonly referenceTarget: string;
    readonly headings: readonly string[];
    readonly blockIds: readonly string[];
  }> = {},
) {
  return {
    label,
    target: label,
    path,
    aliases: overrides.aliases ?? [],
    referenceTarget: overrides.referenceTarget ?? label,
    headings: overrides.headings ?? [],
    blockIds: overrides.blockIds ?? [],
  };
}
