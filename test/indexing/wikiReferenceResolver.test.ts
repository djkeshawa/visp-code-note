import assert = require("node:assert/strict");
import { test } from "node:test";
import { createWikiReferenceResolver } from "../../src/indexing/wikiReferenceResolver";
import { parseMarkdown } from "../../src/markdown/parser";
import { makeNote } from "./fixtures";

test("distinguishes missing notes, headings, and blocks", () => {
  const source = makeNote({ path: "source.md" });
  const target = makeNote({
    path: "target.md",
    content: "# Target\n\n## Existing heading\n\nParagraph ^stable\n",
  });
  const resolver = createWikiReferenceResolver([source, target]);

  assert.equal(resolve(resolver, source.uri, "[[Missing]]").status, "missing-note");
  assert.equal(resolve(resolver, source.uri, "[[Target#Missing]]").status, "missing-heading");
  assert.equal(resolve(resolver, source.uri, "[[Target^missing]]").status, "missing-block");
  assert.equal(resolve(resolver, source.uri, "[[Target#Existing heading]]").status, "resolved");
});

test("uses the block as the final destination for combined references", () => {
  const source = makeNote({ path: "source.md" });
  const target = makeNote({
    path: "target.md",
    content: "# Target\n\n## Existing\n\nParagraph ^stable\n",
  });
  const result = resolve(
    createWikiReferenceResolver([source, target]),
    source.uri,
    "[[Target#Existing^stable]]",
  );
  assert.equal(result.status, "resolved");
  assert.equal(result.status === "resolved" ? result.offset : undefined, target.blockReferences[0]?.range.start);
});

function resolve(
  resolver: ReturnType<typeof createWikiReferenceResolver>,
  sourceUri: string,
  source: string,
) {
  const link = parseMarkdown(source).links[0];
  assert.ok(link);
  return resolver.resolve(sourceUri, link);
}
