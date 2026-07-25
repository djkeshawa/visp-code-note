import assert = require("node:assert/strict");
import { test } from "node:test";
import { planAliasAddition, planTitleChange } from "../../src/application/noteMetadataEdits";
import { applyTextEdits } from "../../src/application/textEdits";

test("changes only the first H1 title text", () => {
  const source = "```md\n# Not the title\n```\n\n# Old title #\n\nKeep # inline\n";
  const edit = planTitleChange(source, "New title");

  assert.ok(edit);
  assert.equal(
    applyTextEdits(source, [edit]),
    "```md\n# Not the title\n```\n\n# New title #\n\nKeep # inline\n",
  );
});

test("adds an alias through a narrow frontmatter edit", () => {
  const withoutFrontmatter = "# New title\n\nBody\n";
  const created = applyTextEdits(withoutFrontmatter, [
    planAliasAddition(withoutFrontmatter, "Old title"),
  ]);
  assert.equal(created, '---\naliases:\n  - "Old title"\n---\n\n# New title\n\nBody\n');

  const inline = "---\ntags: [one]\naliases: [Existing]\n---\n# New\n";
  const updated = applyTextEdits(inline, [planAliasAddition(inline, "Old title")]);
  assert.match(updated, /aliases: \["Existing", "Old title"\]/);
  assert.match(updated, /tags: \[one\]/);

  const scalar = "---\naliases: Existing\n---\n# New\n";
  const scalarUpdated = applyTextEdits(scalar, [planAliasAddition(scalar, "Old title")]);
  assert.match(scalarUpdated, /aliases: \["Existing", "Old title"\]/);
});

test("updates a frontmatter title instead of an unrelated H1", () => {
  const source = "---\ntitle: Old title\ntags: [keep]\n---\n\n# Display heading\n";
  const edit = planTitleChange(source, "New title");

  assert.ok(edit);
  assert.equal(
    applyTextEdits(source, [edit]),
    "---\ntitle: New title\ntags: [keep]\n---\n\n# Display heading\n",
  );
});

test("preserves YAML inline comments while changing titles and aliases", () => {
  const source = [
    "---",
    "title: 'Old title' # keep title note",
    "aliases: [Existing] # keep alias note",
    "---",
    "# Display",
    "",
  ].join("\n");
  const result = applyTextEdits(source, [
    planTitleChange(source, "New title")!,
    planAliasAddition(source, "Old title"),
  ]);

  assert.match(result, /title: 'New title' # keep title note/);
  assert.match(result, /aliases: \["Existing", "Old title"\] # keep alias note/);
});

test("preserves indentationless YAML alias sequences", () => {
  const source = "---\naliases:\n- Existing\ntags: [one]\n---\n# New\n";
  const result = applyTextEdits(source, [planAliasAddition(source, "Old title")]);

  assert.equal(
    result,
    "---\naliases:\n- Existing\n- \"Old title\"\ntags: [one]\n---\n# New\n",
  );
});

test("refuses unsupported YAML alias block scalars", () => {
  const source = "---\naliases: |\n  Existing\n---\n# New\n";
  assert.throws(
    () => planAliasAddition(source, "Old title"),
    /cannot safely edit/i,
  );
});

test("refuses multiline and comment-separated YAML alias sequences", () => {
  const blockItem = "---\naliases:\n  - |-\n    Existing\n---\n# New\n";
  const separated = "---\naliases:\n# keep\n- Existing\n---\n# New\n";
  assert.throws(() => planAliasAddition(blockItem, "Old title"), /cannot safely edit/i);
  assert.throws(() => planAliasAddition(separated, "Old title"), /cannot safely edit/i);
});

test("refuses complex YAML titles without changing continuation lines", () => {
  const block = "---\ntitle: |\n  Old title\n---\n# Display\n";
  const flow = "---\ntitle: [\n  Old title\n]\n---\n# Display\n";
  const anchored = "---\ntitle: &name |\n  Old title\n---\n# Display\n";
  assert.throws(() => planTitleChange(block, "New title"), /cannot safely edit/i);
  assert.throws(() => planTitleChange(flow, "New title"), /cannot safely edit/i);
  assert.throws(() => planTitleChange(anchored, "New title"), /cannot safely edit/i);
});

test("adds an explicit title when a note has no title source", () => {
  const plain = "Body only\n";
  assert.equal(
    applyTextEdits(plain, [planTitleChange(plain, "Requested title")!]),
    "# Requested title\n\nBody only\n",
  );

  const frontmatter = "---\ntags: [one]\n---\nBody only\n";
  assert.equal(
    applyTextEdits(frontmatter, [planTitleChange(frontmatter, "Requested title")!]),
    "---\ntags: [one]\ntitle: Requested title\n---\nBody only\n",
  );
});

test("preserves a BOM and supports an empty frontmatter title", () => {
  const bomSource = "\uFEFFBody\n";
  assert.equal(
    applyTextEdits(bomSource, [planTitleChange(bomSource, "Named")!]),
    "\uFEFF# Named\n\nBody\n",
  );
  assert.equal(
    applyTextEdits(bomSource, [planAliasAddition(bomSource, "Old")]),
    "\uFEFF---\naliases:\n  - \"Old\"\n---\n\nBody\n",
  );

  const emptyTitle = "---\ntitle:\ntags: [one]\n---\n# Display\n";
  assert.match(
    applyTextEdits(emptyTitle, [planTitleChange(emptyTitle, "Named")!]),
    /title: Named/,
  );

  const commentedTitle = "---\ntitle: # keep\n---\n# Display\n";
  assert.match(
    applyTextEdits(commentedTitle, [planTitleChange(commentedTitle, "Named")!]),
    /title: Named # keep/,
  );
});

test("quotes titles with YAML implicit scalar types", () => {
  for (const title of ["false", "null", "2026-01-01", "42", "0123", "1_000"]) {
    const source = "---\ntitle: Old\n---\n";
    assert.match(applyTextEdits(source, [planTitleChange(source, title)!]), /title: "/);
  }
});

test("normalizes supported alias scalars without changing their meaning", () => {
  const scalar = "---\naliases: Old, imported\n---\n# Note\n";
  assert.match(
    applyTextEdits(scalar, [planAliasAddition(scalar, "Previous")]),
    /aliases: \["Old, imported", "Previous"\]/,
  );
  const malformedFlow = "---\naliases: [Existing]]\n---\n# Note\n";
  assert.throws(() => planAliasAddition(malformedFlow, "Previous"), /cannot safely edit/i);
});
