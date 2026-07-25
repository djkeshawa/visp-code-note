import assert = require("node:assert/strict");
import { test } from "node:test";
import { parseMarkdown } from "../../src/markdown/parser";

test("indexes explicit block IDs while excluding protected Markdown", () => {
  const source = [
    "---",
    "internal: ^frontmatter",
    "---",
    "Paragraph ^stable",
    "<!-- hidden ^comment -->",
    "`inline ^code`",
    "```md",
    "fenced ^code",
    "```",
    "[destination](https://example.test/^hidden)",
    "Another paragraph ^second.id",
  ].join("\n");
  const references = parseMarkdown(source).blockReferences;

  assert.deepEqual(references.map((reference) => reference.id), ["stable", "second.id"]);
  for (const reference of references) {
    assert.equal(source.slice(reference.range.start, reference.range.end), `^${reference.id}`);
  }
});
