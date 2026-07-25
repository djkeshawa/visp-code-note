import assert = require("node:assert/strict");
import { test } from "node:test";
import type { NoteSuggestion } from "../../src/domain/protocol";
import {
  limitWikiSuggestions,
  rankWikiSuggestions,
} from "../../src/application/wikiSuggestions";

const notes: readonly NoteSuggestion[] = [
  {
    label: "Current",
    target: "Current",
    path: "current.md",
    aliases: ["Home"],
    referenceTarget: "",
    headings: ["Local heading"],
    blockIds: ["local-block"],
  },
  {
    label: "Architecture",
    target: "Architecture",
    path: "docs/architecture.md",
    aliases: ["System design"],
    referenceTarget: "Architecture",
    headings: ["Indexing", "Runtime | lifecycle"],
    blockIds: ["parser-block"],
  },
];

test("ranks notes by alias and emits source-aware references", () => {
  assert.equal(rankWikiSuggestions(notes, "system")[0]?.target, "Architecture");
  assert.equal(rankWikiSuggestions(notes, "#local")[0]?.target, "#Local heading");
  assert.equal(
    rankWikiSuggestions(notes, "Architecture#runtime")[0]?.target,
    "Architecture#Runtime %7C lifecycle",
  );
  assert.equal(
    rankWikiSuggestions(notes, "Architecture^parser")[0]?.target,
    "Architecture^parser-block",
  );
});

test("preserves an existing heading when completing a combined block reference", () => {
  const candidate = rankWikiSuggestions(notes, "Architecture#Indexing^par")[0];
  assert.equal(candidate?.target, "Architecture#Indexing^parser-block");
  assert.match(candidate?.filterText ?? "", /Architecture#Indexing\^parser-block/);
});

test("keeps alias and explicit self-title anchor queries filterable", () => {
  const aliasCandidate = rankWikiSuggestions(notes, "System design#run")[0];
  assert.match(aliasCandidate?.filterText ?? "", /System design#Runtime %7C lifecycle/);

  const selfCandidate = rankWikiSuggestions(notes, "Current#local")[0];
  assert.equal(selfCandidate?.target, "#Local heading");
  assert.match(selfCandidate?.filterText ?? "", /Current#Local heading/);
});

test("marks a limited completion batch as incomplete", () => {
  const candidates = rankWikiSuggestions(notes, "");
  assert.deepEqual(limitWikiSuggestions(candidates, 1), {
    items: candidates.slice(0, 1),
    isIncomplete: true,
  });
  assert.equal(limitWikiSuggestions(candidates, candidates.length).isIncomplete, false);
});
