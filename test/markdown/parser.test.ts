import assert = require("node:assert/strict");
import { test } from "node:test";
import { parseMarkdown } from "../../src/markdown/parser";

test("parses simple YAML frontmatter and gives its title precedence", () => {
  const source = [
    "---",
    'title: "Project Atlas"',
    "aliases:",
    "  - Atlas",
    '  - "World, Map"',
    'tags: [planning, "Deep Work"] # a YAML comment',
    "status: active",
    "---",
    "# Different heading",
    "Body #planning #Inline",
    "",
  ].join("\r\n");

  const note = parseMarkdown(source);

  assert.equal(note.title, "Project Atlas");
  assert.deepEqual(note.aliases, ["Atlas", "World, Map"]);
  assert.deepEqual(note.frontmatter, {
    title: "Project Atlas",
    aliases: ["Atlas", "World, Map"],
    tags: ["planning", "Deep Work"],
    status: "active",
  });
  assert.deepEqual(note.tags, ["planning", "Deep Work", "Inline"]);
  assert.equal(note.blocks[0]?.id, "frontmatter");
  assert.equal(note.blocks.map((block) => block.source).join(""), source);
  assertContiguousBlocks(source, note.blocks);
});

test("parses indentationless frontmatter sequences", () => {
  const note = parseMarkdown("---\naliases:\n- First\n- Second\n---\n# Note\n");
  assert.deepEqual(note.aliases, ["First", "Second"]);
});

test("uses the first non-empty H1 as title and recognizes ATX and setext headings", () => {
  const source = "## Before\n\nSetext title\n============\n\n### Café & APIs ###\n# Later\n";
  const note = parseMarkdown(source);

  assert.equal(note.title, "Setext title");
  assert.deepEqual(
    note.headings.map(({ level, text, slug }) => ({ level, text, slug })),
    [
      { level: 2, text: "Before", slug: "before" },
      { level: 1, text: "Setext title", slug: "setext-title" },
      { level: 3, text: "Café & APIs", slug: "cafe-apis" },
      { level: 1, text: "Later", slug: "later" },
    ],
  );
  for (const heading of note.headings) {
    assert.ok(source.slice(heading.range.start, heading.range.end).includes(heading.text));
  }
});

test("does not treat an unclosed frontmatter marker as metadata", () => {
  const source = "---\ntitle: Not metadata\n# Actual title\n";
  const note = parseMarkdown(source);

  assert.equal(note.frontmatter, undefined);
  assert.equal(note.title, "Actual title");
  assert.equal(note.blocks[0]?.kind, "thematic-break");
  assert.equal(note.blocks.map((block) => block.source).join(""), source);
});

test("preserves LF, CRLF, and legacy CR line endings in exact block offsets", () => {
  const source = "# One\rParagraph\r\ncontinued\n\n- [ ] Task";
  const note = parseMarkdown(source);

  assert.equal(note.headings[0]?.text, "One");
  assert.equal(note.tasks[0]?.line, 4);
  assertContiguousBlocks(source, note.blocks);
});

test("treats multiline HTML comments as one non-semantic source-preserving block", () => {
  const source = [
    "<!--",
    "# Hidden title",
    "- [ ] Hidden task #secret [[Ghost]]",
    "-->",
    "# Visible title",
    "- [ ] Visible task #shown [[Target]]",
  ].join("\r\n");
  const note = parseMarkdown(source);

  assert.equal(note.title, "Visible title");
  assert.deepEqual(note.headings.map((heading) => heading.text), ["Visible title"]);
  assert.deepEqual(note.tasks.map((task) => task.text), ["Visible task [[Target]]"]);
  assert.deepEqual(note.tags, ["shown"]);
  assert.deepEqual(note.links.map((link) => link.target), ["Target"]);
  assert.deepEqual(note.blocks.map((block) => block.kind), ["code", "heading", "task"]);
  assert.equal(note.blocks[0]?.source, source.slice(0, source.indexOf("# Visible title")));
  assertContiguousBlocks(source, note.blocks);
});

test("protects inline-starting and unclosed multiline comments through end of source", () => {
  const closed = "Visible prefix <!--\n# Hidden\n--> suffix\n# Actual\n";
  const closedNote = parseMarkdown(closed);
  assert.equal(closedNote.title, "Actual");
  assert.deepEqual(closedNote.blocks.map((block) => block.kind), ["code", "heading"]);
  assertContiguousBlocks(closed, closedNote.blocks);

  const unclosed = "<!--\n# Hidden\n- [ ] Hidden [[Ghost]] #secret";
  const unclosedNote = parseMarkdown(unclosed);
  assert.equal(unclosedNote.title, undefined);
  assert.deepEqual(unclosedNote.headings, []);
  assert.deepEqual(unclosedNote.tasks, []);
  assert.deepEqual(unclosedNote.links, []);
  assert.deepEqual(unclosedNote.tags, []);
  assert.deepEqual(unclosedNote.blocks.map((block) => block.kind), ["code"]);
  assertContiguousBlocks(unclosed, unclosedNote.blocks);
});

test("continues comment protection when frontmatter consumed the comment opening", () => {
  const source = [
    "---",
    "title: Configured title",
    "<!--",
    "---",
    "# Hidden heading",
    "-->",
    "# Visible outline heading",
  ].join("\n");
  const note = parseMarkdown(source);

  assert.equal(note.title, "Configured title");
  assert.deepEqual(note.headings.map((heading) => heading.text), ["Visible outline heading"]);
  assert.deepEqual(note.blocks.map((block) => block.kind), ["code", "code", "heading"]);
  assertContiguousBlocks(source, note.blocks);
});

test("block ranges preserve every source character across Markdown block kinds", () => {
  const source = [
    "# Heading",
    "",
    "A paragraph",
    "continued.",
    "",
    "> quote",
    "> continued",
    "",
    "- list item",
    "  continuation",
    "- [ ] task",
    "",
    "    indented code",
    "",
    "~~~ts",
    "const value = 1;",
    "~~~",
    "",
    "* * *",
  ].join("\n");
  const note = parseMarkdown(source);

  assert.deepEqual(note.blocks.map((block) => block.kind), [
    "heading",
    "blank",
    "paragraph",
    "blank",
    "blockquote",
    "blank",
    "list",
    "task",
    "blank",
    "code",
    "code",
    "blank",
    "thematic-break",
  ]);
  assertContiguousBlocks(source, note.blocks);
});

function assertContiguousBlocks(
  source: string,
  blocks: readonly { readonly source: string; readonly range: { readonly start: number; readonly end: number } }[],
): void {
  let offset = 0;
  for (const block of blocks) {
    assert.equal(block.range.start, offset);
    assert.equal(block.source, source.slice(block.range.start, block.range.end));
    offset = block.range.end;
  }
  assert.equal(offset, source.length);
}
