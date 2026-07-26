import assert = require("node:assert/strict");
import { test } from "node:test";
import { outlineFoldAt, outlineFolds } from "../../src/markdown/outline";

function lines(source: string): readonly string[] {
  return source.split("\n");
}

function foldAt(source: string, index: number): string | undefined {
  const all = lines(source);
  const fold = outlineFoldAt(all, index);
  return fold === undefined
    ? undefined
    : all.slice(fold.startLine, fold.endLine + 1).join("\n");
}

const document = [
  "# Title",             // 0
  "",                    // 1
  "Intro paragraph.",    // 2
  "",                    // 3
  "## Section one",      // 4
  "",                    // 5
  "- parent",            // 6
  "  - child",           // 7
  "    - grandchild",    // 8
  "- sibling",           // 9
  "",                    // 10
  "### Subsection",      // 11
  "Body.",               // 12
  "",                    // 13
  "## Section two",      // 14
  "Tail.",               // 15
].join("\n");

test("a heading folds to just before the next heading of the same level", () => {
  assert.equal(
    foldAt(document, 4),
    ["## Section one", "", "- parent", "  - child", "    - grandchild", "- sibling", "",
     "### Subsection", "Body."].join("\n"),
  );
});

test("a deeper heading stops at a shallower one, not at its own level", () => {
  assert.equal(foldAt(document, 11), ["### Subsection", "Body."].join("\n"));
});

test("the top heading folds the whole document below it", () => {
  const folded = foldAt(document, 0);

  assert.ok(folded?.startsWith("# Title"));
  assert.ok(folded?.endsWith("Tail."));
});

test("a list item folds its nested children and stops at its sibling", () => {
  assert.equal(foldAt(document, 6), ["- parent", "  - child", "    - grandchild"].join("\n"));
  assert.equal(foldAt(document, 7), ["  - child", "    - grandchild"].join("\n"));
});

test("a leaf item and a plain paragraph have nothing to fold", () => {
  assert.equal(foldAt(document, 8), undefined, "grandchild is a leaf");
  assert.equal(foldAt(document, 9), undefined, "sibling has no children");
  assert.equal(foldAt(document, 2), undefined, "a paragraph is not foldable");
  assert.equal(foldAt(document, 15), undefined, "last line, nothing below");
});

test("trailing blank lines are left outside the fold", () => {
  const source = ["## Section", "Body.", "", "", "## Next"].join("\n");

  assert.equal(foldAt(source, 0), ["## Section", "Body."].join("\n"));
});

test("a hash inside a fenced block is not treated as a heading", () => {
  const source = [
    "## Real heading",   // 0
    "```bash",           // 1
    "# not a heading",   // 2
    "echo hi",           // 3
    "```",               // 4
    "After.",            // 5
  ].join("\n");

  // The fold must run past the fence to the end, rather than stopping at line 2.
  assert.equal(foldAt(source, 0), source);
  assert.equal(foldAt(source, 2), undefined, "a fenced line is never a fold start");
});

test("tilde fences and unclosed fences are handled", () => {
  const tilde = ["## H", "~~~", "# inside", "~~~", "End."].join("\n");
  assert.equal(foldAt(tilde, 0), tilde);

  const unclosed = ["## H", "```", "# inside", "still inside"].join("\n");
  assert.equal(foldAt(unclosed, 0), unclosed);
});

test("ordered lists fold like bullet lists", () => {
  const source = ["1. parent", "   1. child", "2. sibling"].join("\n");

  assert.equal(foldAt(source, 0), ["1. parent", "   1. child"].join("\n"));
  assert.equal(foldAt(source, 2), undefined);
});

test("a heading closes an enclosing list rather than being swallowed by it", () => {
  const source = ["- item", "  - child", "## Heading", "  indented prose"].join("\n");

  assert.equal(foldAt(source, 0), ["- item", "  - child"].join("\n"));
});

test("a blank line inside a list does not end the fold", () => {
  const source = ["- parent", "", "  - child", "- sibling"].join("\n");

  assert.equal(foldAt(source, 0), ["- parent", "", "  - child"].join("\n"));
});

test("every fold in a document is reported, outermost first", () => {
  const found = outlineFolds(lines(document));

  assert.deepEqual(
    found.map((fold) => fold.startLine),
    [0, 4, 6, 7, 11, 14],
  );
  assert.equal(found[0]?.startLine, 0, "the outermost heading comes first");
});

test("an empty document folds nothing", () => {
  assert.deepEqual(outlineFolds([]), []);
  assert.deepEqual(outlineFolds([""]), []);
  assert.equal(outlineFoldAt([], 0), undefined);
  assert.equal(outlineFoldAt(["# Only"], 5), undefined, "out-of-range index is safe");
});
