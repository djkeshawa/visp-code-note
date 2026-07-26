import assert = require("node:assert/strict");
import { test } from "node:test";
import { parseCalloutBlock, parseCalloutHeader } from "../../src/markdown/callouts";

test("parses a callout header with exact marker offsets", () => {
  const header = parseCalloutHeader("> [!warning] Check the migration");

  assert.equal(header?.kind, "warning");
  assert.equal(header?.tone, "warning");
  assert.equal(header?.title, "Check the migration");
  assert.equal("> [!warning] Check the migration".slice(header?.markerStart, header?.markerEnd), "[!warning]");
});

test("accepts fold markers, indentation and a missing title", () => {
  const folded = parseCalloutHeader("   >[!tip]-");

  assert.equal(folded?.kind, "tip");
  assert.equal(folded?.title, "");
  assert.equal("   >[!tip]-".slice(folded?.markerStart, folded?.markerEnd), "[!tip]-");
});

test("maps aliases onto a small tone palette and falls back to note", () => {
  assert.equal(parseCalloutHeader("> [!caution] x")?.tone, "warning");
  assert.equal(parseCalloutHeader("> [!bug] x")?.tone, "danger");
  assert.equal(parseCalloutHeader("> [!done] x")?.tone, "success");
  assert.equal(parseCalloutHeader("> [!INFO] x")?.kind, "info");
  assert.equal(parseCalloutHeader("> [!unheard-of] x")?.tone, "note");
});

test("plain blockquotes and non-blockquote lines are not callouts", () => {
  assert.equal(parseCalloutHeader("> Just a quotation"), undefined);
  assert.equal(parseCalloutHeader("[!note] Not quoted"), undefined);
  assert.equal(parseCalloutHeader("> [!] Empty type"), undefined);
});

test("only the block's first line can open a callout", () => {
  assert.equal(parseCalloutBlock("> [!note] Heads up\n> Body text")?.kind, "note");
  assert.equal(parseCalloutBlock("> Body text\n> [!note] Too late"), undefined);
  assert.equal(parseCalloutBlock("> [!note] CRLF handling\r\n> Body")?.kind, "note");
});
