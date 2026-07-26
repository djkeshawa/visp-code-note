import assert = require("node:assert/strict");
import { test } from "node:test";
import { planTagAddition, planTagRemoval } from "../../src/application/noteMetadataEdits";
import { applyTextEdits } from "../../src/application/textEdits";
import { parseMarkdown } from "../../src/markdown/parser";

function added(source: string, tag: string): string {
  return applyTextEdits(source, [planTagAddition(source, tag)]);
}

function removed(source: string, tag: string): string {
  const edit = planTagRemoval(source, tag);
  return edit === undefined ? source : applyTextEdits(source, [edit]);
}

function tagsOf(source: string): readonly string[] {
  return parseMarkdown(source).tags;
}

test("creates frontmatter when the note has none, preserving the body", () => {
  const result = added("# Atlas\n\nBody text.\n", "product");

  assert.equal(result, '---\ntags:\n  - "product"\n---\n\n# Atlas\n\nBody text.\n');
  assert.deepEqual(tagsOf(result), ["product"]);
});

test("adds a tags property to frontmatter that lacks one", () => {
  const source = "---\ntitle: Atlas\n---\n\nBody.\n";

  const result = added(source, "product");

  assert.match(result, /^---\ntitle: Atlas\ntags:\n {2}- "product"\n---/);
  assert.deepEqual(tagsOf(result), ["product"]);
});

test("appends to an inline list and to a block sequence in their own style", () => {
  const inline = added('---\ntags: [product, "Deep Work"]\n---\n', "planning");
  const block = added("---\ntags:\n  - product\n  - planning\n---\n", "docs");

  assert.match(inline, /tags: \[product, "Deep Work", "planning"\]/);
  assert.match(block, /tags:\n {2}- product\n {2}- planning\n {2}- "docs"\n/);
  assert.deepEqual(tagsOf(inline), ["product", "Deep Work", "planning"]);
  assert.deepEqual(tagsOf(block), ["product", "planning", "docs"]);
});

test("promotes a single scalar to a list instead of duplicating the key", () => {
  const result = added("---\ntags: product\n---\n", "planning");

  assert.match(result, /tags: \["product", "planning"\]/);
  assert.equal(result.match(/^tags:/gm)?.length, 1);
  assert.deepEqual(tagsOf(result), ["product", "planning"]);
});

test("keeps a BOM, CRLF endings, and the sequence indentation the file already uses", () => {
  const crlf = added("﻿---\r\ntags:\r\n    - product\r\n---\r\n", "docs");

  assert.ok(crlf.startsWith("﻿"), "BOM preserved");
  assert.ok(!crlf.includes("\n\n"), "no stray bare newline introduced");
  assert.match(crlf, /\r\n {4}- "docs"\r\n/);
  assert.deepEqual(tagsOf(crlf), ["product", "docs"]);
});

test("removes from an inline list and leaves an explicit empty list behind", () => {
  const some = removed('---\ntags: [product, "Deep Work"]\n---\n', "Deep Work");
  const last = removed("---\ntags: [product]\n---\n", "product");

  assert.match(some, /tags: \[product\]/);
  assert.match(last, /tags: \[\]/);
  assert.deepEqual(tagsOf(last), []);
});

test("removes one item from a block sequence without leaving a blank line", () => {
  const result = removed("---\ntags:\n  - product\n  - planning\n  - docs\n---\n", "planning");

  assert.equal(result, "---\ntags:\n  - product\n  - docs\n---\n");
  assert.deepEqual(tagsOf(result), ["product", "docs"]);
});

test("removes the first and last items of a block sequence correctly", () => {
  const source = "---\ntags:\n  - product\n  - docs\n---\n";

  assert.equal(removed(source, "product"), "---\ntags:\n  - docs\n---\n");
  assert.equal(removed(source, "docs"), "---\ntags:\n  - product\n---\n");
});

test("matches tags case-insensitively and ignores a leading hash", () => {
  assert.match(removed("---\ntags: [Product]\n---\n", "product"), /tags: \[\]/);
  assert.match(removed('---\ntags: ["deep work"]\n---\n', "#deep work"), /tags: \[\]/);
});

test("leaves the file untouched when the tag is not in frontmatter", () => {
  // Inline-only tags belong to the prose, which this planner never rewrites.
  const inlineOnly = "---\ntitle: Atlas\n---\n\nAbout #product work.\n";

  assert.equal(planTagRemoval(inlineOnly, "product"), undefined);
  assert.equal(removed(inlineOnly, "product"), inlineOnly);
  assert.deepEqual(tagsOf(inlineOnly), ["product"]);
  assert.equal(planTagRemoval("# No frontmatter\n", "product"), undefined);
  assert.equal(planTagRemoval("---\ntags: [product]\n---\n", "absent"), undefined);
});

test("preserves a YAML comment sitting beside the tags value", () => {
  const result = added("---\ntags: [product] # keep me\n---\n", "docs");

  assert.match(result, /# keep me/);
  assert.match(result, /tags: \[product, "docs"\]/);
});

test("refuses YAML it cannot edit safely rather than half-editing it", () => {
  const blockScalar = "---\ntags: |\n  product\n---\n";
  const nested = "---\ntags:\n  - name: product\n---\n";

  assert.throws(() => planTagAddition(blockScalar, "docs"), /cannot safely edit/);
  assert.throws(() => planTagRemoval(nested, "product"), /cannot safely edit/);
});

test("quotes values that YAML would otherwise read as another type", () => {
  const result = added("---\ntags: [product]\n---\n", "true");

  assert.match(result, /"true"/);
  assert.deepEqual(tagsOf(result), ["product", "true"]);
});
