import assert = require("node:assert/strict");
import { test } from "node:test";
import { buildWorkspaceSearchResults } from "../../src/application/workspaceSearch";
import { buildSnapshot } from "../../src/indexing/projections";
import { makeNote } from "../indexing/fixtures";

const content = [
  "---",
  "title: Atlas",
  "aliases: [North Star]",
  "tags: [planning]",
  "---",
  "# Atlas",
  "A short introduction.",
  "Before 😀 a body-only C++ signal after the emoji.",
  "- [ ] Ship release #urgent @due(2026-07-23) @priority(high)",
].join("\r\n");
const note = makeNote({ path: "knowledge/field-atlas.md", content });
const snapshot = buildSnapshot([note], 1, 1);

test("searches note titles, paths, aliases, tags, and body text", () => {
  const cases = [
    ["atlas", "title"],
    ["field-atlas", "path"],
    ["north star", "alias"],
    ["planning", "tag"],
    ["C++ signal", "body"],
  ] as const;

  for (const [query, expectedField] of cases) {
    const result = buildWorkspaceSearchResults(snapshot, query).find((item) => item.kind === "note");
    assert.equal(result?.matchedField, expectedField, query);
  }
});

test("preserves UTF-16 source offsets for body and task matches", () => {
  const bodyResult = buildWorkspaceSearchResults(snapshot, "body-only").find(
    (item) => item.kind === "note",
  );
  const taskResult = buildWorkspaceSearchResults(snapshot, "Ship release").find(
    (item) => item.kind === "task",
  );
  const dueResult = buildWorkspaceSearchResults(snapshot, "2026-07-23").find(
    (item) => item.kind === "task",
  );
  const tagResult = buildWorkspaceSearchResults(snapshot, "planning").find(
    (item) => item.kind === "note",
  );

  assert.equal(bodyResult?.offset, content.indexOf("body-only"));
  assert.equal(taskResult?.offset, content.indexOf("Ship release"));
  assert.equal(dueResult?.offset, content.indexOf("2026-07-23"));
  assert.equal(tagResult?.offset, content.indexOf("planning"));
});

test("returns bounded, useful snippets without retaining note content", () => {
  const longContent = `# Long\n${"a".repeat(180)} needle ${"z".repeat(180)}\nprivate trailing line`;
  const longNote = makeNote({ path: "long.md", content: longContent });
  const result = buildWorkspaceSearchResults(buildSnapshot([longNote]), "needle")[0];

  assert.equal(result?.kind, "note");
  assert.match(result?.preview ?? "", /needle/);
  assert.ok((result?.preview.length ?? Infinity) <= 142);
  assert.doesNotMatch(result?.preview ?? "", /private trailing line/);
  assert.equal(result !== undefined && "content" in result, false);
});

test("matches multiple terms across searchable fields and enforces the result limit", () => {
  const crossField = buildWorkspaceSearchResults(snapshot, "Atlas body-only");
  assert.equal(crossField.some((result) => result.kind === "note"), true);
  assert.equal(buildWorkspaceSearchResults(snapshot, "missing term").length, 0);
  assert.equal(buildWorkspaceSearchResults(snapshot, "", 1).length, 1);
  assert.equal(buildWorkspaceSearchResults(snapshot, "", 0).length, 0);
});

/*
 * When a hundred results score identically — which a broad query produces easily — the order
 * used to come down to the file path, alphabetically. That is arbitrary. Which note was
 * written most recently is not, and it is usually the one being looked for.
 */
test("results that score the same are ordered by which note was touched last", () => {
  const older = makeNote({ path: "a-first.md", content: "# Standup\n\nplanning\n", modifiedAt: 100 });
  const newer = makeNote({ path: "z-last.md", content: "# Standup\n\nplanning\n", modifiedAt: 900 });

  const results = buildWorkspaceSearchResults(buildSnapshot([older, newer], 1, 1), "planning");

  assert.deepEqual(results.map((result) => result.notePath), ["z-last.md", "a-first.md"]);
});

/* Two notes written in the same second still need one order, and the path is the one to use. */
test("notes touched at the same moment keep a stable order", () => {
  const first = makeNote({ path: "a-first.md", content: "# Standup\n\nplanning\n", modifiedAt: 500 });
  const second = makeNote({ path: "z-last.md", content: "# Standup\n\nplanning\n", modifiedAt: 500 });

  const results = buildWorkspaceSearchResults(buildSnapshot([second, first], 1, 1), "planning");

  assert.deepEqual(results.map((result) => result.notePath), ["a-first.md", "z-last.md"]);
});
