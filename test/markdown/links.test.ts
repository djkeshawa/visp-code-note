import assert = require("node:assert/strict");
import { test } from "node:test";
import { parseMarkdown } from "../../src/markdown/parser";

test("parses wiki aliases, headings, block references, and exact ranges", () => {
  const source = [
    "[[Architecture decisions]]",
    "[[Architecture decisions|system design choices]]",
    "[[Architecture decisions#Indexing]]",
    "[[Architecture decisions^parser-block]]",
    "[[Architecture decisions#Indexing^parser-block|details]]",
    "[[#Local heading]]",
  ].join("\n");
  const links = parseMarkdown(source).links;

  assert.equal(links.length, 6);
  assert.deepEqual(links[1], {
    raw: "[[Architecture decisions|system design choices]]",
    target: "Architecture decisions",
    alias: "system design choices",
    range: {
      start: source.indexOf("[[Architecture decisions|system design choices]]"),
      end:
        source.indexOf("[[Architecture decisions|system design choices]]") +
        "[[Architecture decisions|system design choices]]".length,
    },
  });
  assert.equal(links[2]?.heading, "Indexing");
  assert.equal(links[3]?.blockId, "parser-block");
  assert.deepEqual(
    { heading: links[4]?.heading, blockId: links[4]?.blockId, alias: links[4]?.alias },
    { heading: "Indexing", blockId: "parser-block", alias: "details" },
  );
  assert.deepEqual(
    { target: links[5]?.target, heading: links[5]?.heading },
    { target: "", heading: "Local heading" },
  );
  for (const link of links) {
    assert.equal(source.slice(link.range.start, link.range.end), link.raw);
  }
});

test("ignores links and tags inside frontmatter, comments, inline code, and code blocks", () => {
  const source = [
    "---",
    "title: Protected",
    "tags: [frontmatter]",
    "---",
    "Real [[Target#Not-a-tag]] #Visible #visible",
    "`[[Inline code]] #HiddenInline`",
    "<!-- [[Comment]] #HiddenComment -->",
    "```md",
    "[[Fenced]] #HiddenFence",
    "```",
  ].join("\n");
  const note = parseMarkdown(source);

  assert.deepEqual(note.links.map((link) => link.target), ["Target"]);
  assert.deepEqual(note.tags, ["frontmatter", "Visible"]);
});

test("protects fenced code nested under blockquotes and list items", () => {
  const source = [
    "> ```md",
    "> [[Quoted hidden]] #quoted-hidden",
    "> ```",
    "",
    "- list item",
    "  ```md",
    "  [[List hidden]] #list-hidden",
    "  ```",
    "",
    "[[Visible]] #shown",
  ].join("\n");
  const note = parseMarkdown(source);

  assert.deepEqual(note.links.map((link) => link.target), ["Visible"]);
  assert.deepEqual(note.tags, ["shown"]);
  assert.equal(note.blocks.map((block) => block.source).join(""), source);
});

test("ignores escaped wiki openers while honoring even backslash parity", () => {
  const source = [
    String.raw`\[[Literal]]`,
    String.raw`\\[[Actual after slash]]`,
    String.raw`\\\[[Also literal]]`,
    "[[Visible]]",
  ].join("\n");
  const note = parseMarkdown(source);

  assert.deepEqual(note.links.map((link) => link.target), ["Actual after slash", "Visible"]);
  for (const link of note.links) {
    assert.equal(source.slice(link.range.start, link.range.end), link.raw);
  }
  assert.equal(note.blocks.map((block) => block.source).join(""), source);
});

test("ignores wiki syntax in raw HTML tags, attributes, and raw-text elements", () => {
  const source = [
    '<span data-note="[[Attribute]]" title=\'value > [[Quoted attribute]]\'>[[Visible child]]</span>',
    "<custom-note",
    '  data-target="[[Multiline attribute]]">',
    "Body [[Visible body]]",
    "</custom-note>",
    '<script>const link = "[[Script value]]";</script>',
    "<style>.example::after { content: '[[Style value]]'; }</style>",
  ].join("\n");
  const note = parseMarkdown(source);

  assert.deepEqual(note.links.map((link) => link.target), ["Visible child", "Visible body"]);
  assert.equal(note.blocks.map((block) => block.source).join(""), source);
  let offset = 0;
  for (const block of note.blocks) {
    assert.equal(block.range.start, offset);
    assert.equal(block.source, source.slice(block.range.start, block.range.end));
    offset = block.range.end;
  }
  assert.equal(offset, source.length);
});

test("ignores wiki-looking text inside Markdown destinations and bare URLs", () => {
  const parsed = parseMarkdown([
    "[download](assets/[[Old]].pdf)",
    "![alt](images/[[Old]].png)",
    "https://example.test/?note=[[Old]]",
    "[reference][[Old]]",
    "Outside [[Real]].",
  ].join("\n"));
  assert.deepEqual(parsed.links.map((link) => link.target), ["Real"]);
});

test("an inequality in prose does not swallow the rest of the note", () => {
  /*
   * `a<b` parses as a tag start, and the search for the closing `>` used to run to the end of
   * the document, protecting everything in between. Wiki links, tags and block references are
   * all skipped inside protected ranges, so one inequality silently emptied the rest of the
   * note out of the index, backlinks and graph. CommonMark ends a raw HTML tag at a blank line.
   */
  const parsed = parseMarkdown(
    "The invariant is that a<b holds.\n\n" +
    "See [[Design Notes]] and [[Benchmarks]]. Tagged #algorithms.\n\n" +
    "Key paragraph ^invariant\n\n" +
    "```js\nconst f = () => 1;\n```\n",
  );

  assert.deepEqual(parsed.links.map((link) => link.target), ["Design Notes", "Benchmarks"]);
  assert.deepEqual([...parsed.tags], ["algorithms"]);
  assert.deepEqual(parsed.blockReferences.map((reference) => reference.id), ["invariant"]);
});

test("a real HTML tag still protects what it contains", () => {
  const parsed = parseMarkdown("Before <span title=\"[[Not A Link]]\">text</span> after [[Real]].\n");
  assert.deepEqual(parsed.links.map((link) => link.target), ["Real"]);
});

test("an oversized tag stops protecting its contents, but ordinary markup does not", () => {
  /*
   * Bounding the search for a tag's closing `>` is what keeps the parse linear, and the price is
   * that a tag longer than the bound is no longer markup. These pin which cases pay it. The
   * realistic oversized tag is an inline image with a base64 data: URI, and base64 carries
   * nothing that could be read as a link or a tag, so it costs nothing there.
   */
  const base64 = `iVBORw0KGgoAAAANSUhEUg${"A".repeat(4000)}`;

  const markdownImage = parseMarkdown(`![alt](data:image/png;base64,${base64})\n\nSee [[Real]] and #real.\n`);
  assert.deepEqual(markdownImage.links.map((link) => link.target), ["Real"]);
  assert.deepEqual([...markdownImage.tags], ["real"]);

  const htmlImage = parseMarkdown(`<img src="data:image/png;base64,${base64}">\n\nSee [[Real]] and #real.\n`);
  assert.deepEqual(htmlImage.links.map((link) => link.target), ["Real"]);
  assert.deepEqual([...htmlImage.tags], ["real"]);

  // A tag that legally spans lines is still markup, and still protects what it holds.
  const multiline = parseMarkdown('<a\n  href="https://example.com"\n  title="[[Hidden]]">t</a> [[Real]]\n');
  assert.deepEqual(multiline.links.map((link) => link.target), ["Real"]);
});
