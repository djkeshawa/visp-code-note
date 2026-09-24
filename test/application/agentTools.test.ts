import assert = require("node:assert/strict");
import { test } from "node:test";
import { answerAgentTool, UNTRUSTED_CONTENT_NOTICE } from "../../src/application/agentTools";
import { buildSnapshot } from "../../src/indexing/projections";
import { makeNote } from "../indexing/fixtures";

const plans = makeNote({ path: "plans.md", content: "# Plans\n\nSee [[Salaries]].\n" });
const salaries = makeNote({ path: "hr/salaries.md", content: "# Salaries\n\nConfidential.\n" });
const snapshot = buildSnapshot([plans, salaries], 1, 1);
const base = { snapshot, today: "2026-09-25" };

test("every answer is framed as note data, not instructions", () => {
  for (const [name, input] of [["readNote", { note: "Plans" }], ["searchNotes", { query: "x" }], ["listTasks", {}]] as const) {
    assert.ok(answerAgentTool(name, input, base).startsWith(UNTRUSTED_CONTENT_NOTICE), name);
  }
});

test("an excluded note is refused even when it is the open one", () => {
  const context = { ...base, exclude: ["hr/**"], active: { note: salaries, content: salaries.content } };
  assert.match(answerAgentTool("activeNote", {}, context), /not shared with agents/);
  assert.doesNotMatch(answerAgentTool("activeNote", {}, context), /Confidential/);
  assert.match(answerAgentTool("readNote", { note: "Salaries" }, context), /No note matches/);
  assert.match(answerAgentTool("noteGraph", {}, context), /No note is open/, "no fallback to the withheld open note");
});

test("inputs a model got wrong are ignored rather than trusted", () => {
  assert.match(answerAgentTool("listTasks", { status: "everything", limit: "lots", note: 42 }, base), /No tasks match/);
  assert.match(answerAgentTool("searchNotes", { query: "   " }, base), /Give a search query/);
});
