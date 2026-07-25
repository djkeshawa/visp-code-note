import assert = require("node:assert/strict");
import { test } from "node:test";
import type { NoteRecord } from "../../src/domain/models";
import { buildSnapshot, buildWorkspaceGraph } from "../../src/indexing/projections";
import { parseMarkdown } from "../../src/markdown/parser";

test("duplicate copied task IDs remain distinct editor blocks and graph nodes", () => {
  const content = [
    "# Note",
    "- [ ] First <!-- task:copied -->",
    "- [ ] Second <!-- task:copied -->",
  ].join("\n");
  const parsed = parseMarkdown(content);
  const taskBlocks = parsed.blocks.filter((block) => block.kind === "task");
  assert.equal(new Set(taskBlocks.map((block) => block.id)).size, 2);

  const note: NoteRecord = {
    ...parsed,
    uri: "file:///notes/note.md",
    path: "notes/note.md",
    fileName: "note.md",
    title: "Note",
    modifiedAt: 1,
    content,
  };
  const graph = buildWorkspaceGraph(buildSnapshot([note]));
  assert.equal(graph.nodes.filter((node) => node.kind === "task").length, 2);
});
