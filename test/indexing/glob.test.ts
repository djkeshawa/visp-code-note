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

test("a refused pattern does not disable the others beside it", () => {
  const patterns = [`${"{a,b}".repeat(30)}/**`, "**/node_modules/**"];
  assert.equal(matchesAnyGlob("node_modules/a.md", patterns), true);
  assert.equal(matchesAnyGlob("notes/a.md", patterns), false);
});
