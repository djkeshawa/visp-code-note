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

test("a leaf item and an unindented paragraph have nothing to fold", () => {
  const lines = ["- leaf", "Just prose.", "More prose."];

  assert.equal(outlineFoldAt(lines, 0), undefined);
  assert.equal(outlineFoldAt(lines, 1), undefined);
  assert.equal(outlineFoldAt(lines, 2), undefined);
});

test("a paragraph folds whatever is indented beneath it", () => {
  // Pressing Tab on the following line nests it, and the parent must then be collapsible —
  // a line does not need a bullet to be a block with children.
  const lines = ["Parent line", "  nested detail", "  more detail", "Sibling line"];

  assert.deepEqual(outlineFoldAt(lines, 0), { startLine: 0, endLine: 2 });
  assert.equal(outlineFoldAt(lines, 1), undefined);
  assert.equal(outlineFoldAt(lines, 3), undefined);
});

test("indented paragraphs nest to any depth", () => {
  const lines = ["Top", "  second", "    third", "      fourth"];

  assert.deepEqual(outlineFoldAt(lines, 0), { startLine: 0, endLine: 3 });
  assert.deepEqual(outlineFoldAt(lines, 1), { startLine: 1, endLine: 3 });
  assert.deepEqual(outlineFoldAt(lines, 2), { startLine: 2, endLine: 3 });
  assert.equal(outlineFoldAt(lines, 3), undefined);
});

test("a paragraph indented under a bullet folds without stealing the bullet's children", () => {
  const lines = ["- item", "  detail of item", "    detail of detail", "- next item"];

  assert.deepEqual(outlineFoldAt(lines, 0), { startLine: 0, endLine: 2 });
  assert.deepEqual(outlineFoldAt(lines, 1), { startLine: 1, endLine: 2 });
  assert.equal(outlineFoldAt(lines, 3), undefined);
});

test("a line inside fenced code is never a fold start", () => {
  // Indentation inside a code sample is content, not outline structure.
  const lines = ["```", "def f():", "    return 1", "```", "After"];

  assert.equal(outlineFoldAt(lines, 1), undefined);
  assert.equal(outlineFoldAt(lines, 2), undefined);
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
