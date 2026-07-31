import assert = require("node:assert/strict");
import { test } from "node:test";
import { matchesAnyGlob } from "../../src/indexing/glob";

test("matches the exclude patterns notes actually use", () => {
  assert.equal(matchesAnyGlob("node_modules/pkg/readme.md", ["**/node_modules/**"]), true);
  assert.equal(matchesAnyGlob("notes/a.md", ["**/node_modules/**"]), false);
  assert.equal(matchesAnyGlob("notes/a.md", ["notes/*.md"]), true);
  assert.equal(matchesAnyGlob("notes/sub/a.md", ["notes/*.md"]), false);
  assert.equal(matchesAnyGlob("a/deep/nested/c.md", ["a/**/c.md"]), true);
});

test("expands brace alternatives", () => {
  const pattern = ["**/{node_modules,dist,out}/**"];
  assert.equal(matchesAnyGlob("dist/a.md", pattern), true);
  assert.equal(matchesAnyGlob("out/a.md", pattern), true);
  assert.equal(matchesAnyGlob("node_modules/a.md", pattern), true);
  assert.equal(matchesAnyGlob("notes/a.md", pattern), false);
});

test("refuses a pattern that would expand beyond any hand-written exclude", () => {
  /*
   * Each group doubles the expansion, and this setting is workspace-scoped, so a cloned
   * repository could ask for 2^30 patterns and stall opening the folder — twenty groups already
   * cost twelve seconds per file. An entry that large excludes nothing instead of expanding,
   * which loses that one exclude rather than the whole session.
   */
  const bomb = `${"{a,b}".repeat(30)}/**`;
  const started = process.hrtime.bigint();
  assert.equal(matchesAnyGlob("notes/x.md", [bomb]), false);
  const elapsed = Number(process.hrtime.bigint() - started) / 1e6;
  assert.ok(elapsed < 500, `a brace bomb took ${elapsed.toFixed(0)}ms`);
});

test("a chain of globstars matches what a single one matches", () => {
  assert.equal(matchesAnyGlob("a/deep/nested/c.md", ["a/**/**/**/c.md"]), true);
  assert.equal(matchesAnyGlob("a/c.md", ["a/**/**/c.md"]), true);
  assert.equal(matchesAnyGlob("a/deep/d.md", ["a/**/**/c.md"]), false);
  assert.equal(matchesAnyGlob("node_modules/pkg/readme.md", ["**/**/node_modules/**"]), true);
  assert.equal(matchesAnyGlob("notes/a.md", ["**/**/node_modules/**"]), false);
  // A trailing globstar still means "and everything below", with no slash to chain onto.
  assert.equal(matchesAnyGlob("a/b/c.md", ["a/**/**"]), true);
});

test("refuses to backtrack exponentially over a chain of globstars", () => {
  /*
   * Each globstar segment used to emit its own optional group, and those groups can all match
   * the same text, so the engine tried every division of the path between them: twelve segments
   * cost fifteen seconds and fourteen cost a hundred. The setting is workspace-scoped like the
   * brace bomb above, and this match runs on the extension host for every keystroke in a
   * Markdown file, so one cloned repository could freeze the window on the first character
   * typed. Collapsing the chain is what keeps this linear; the brace budget never fires here
   * because the pattern contains no braces.
   */
  const bomb = `${"**/".repeat(14)}q`;
  const path = `${Array.from({ length: 20 }, (_, index) => `dir${index}`).join("/")}/readme.md`;
  const started = process.hrtime.bigint();
  assert.equal(matchesAnyGlob(path, [bomb]), false);
  const elapsed = Number(process.hrtime.bigint() - started) / 1e6;
  assert.ok(elapsed < 500, `a globstar chain took ${elapsed.toFixed(0)}ms`);
});

test("a refused pattern does not disable the others beside it", () => {
  const patterns = [`${"{a,b}".repeat(30)}/**`, "**/node_modules/**"];
  assert.equal(matchesAnyGlob("node_modules/a.md", patterns), true);
  assert.equal(matchesAnyGlob("notes/a.md", patterns), false);
});
