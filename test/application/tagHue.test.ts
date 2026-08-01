import assert = require("node:assert/strict");
import { test } from "node:test";
import { TAG_HUES, tagHue, tagHueColor } from "../../src/application/tagHue";

test("a tag keeps the same hue every time it is asked for", () => {
  assert.equal(tagHue("research"), tagHue("research"));
  assert.equal(tagHueColor("research"), tagHueColor("research"));
});

/*
 * The tree, the note header and the task list all colour the same tag, and each reaches it in
 * a different shape — `#Writing` from prose, `writing` from frontmatter. A hue that depended
 * on which one asked would make the colour meaningless.
 */
test("case and a leading hash are not part of a tag's identity", () => {
  assert.equal(tagHue("#Writing"), tagHue("writing"));
  assert.equal(tagHue("TOOLING"), tagHue("tooling"));
});

test("every hue is one the stylesheet defines", () => {
  for (const name of ["research", "writing", "tooling", "active", "chore", "performance"]) {
    assert.ok(TAG_HUES.includes(tagHue(name)), `${name} resolved outside the palette`);
    assert.equal(tagHueColor(name), `var(--visp-hue-${tagHue(name)})`);
  }
});

test("an empty tag name still resolves to a hue rather than to nothing", () => {
  assert.ok(TAG_HUES.includes(tagHue("")));
});

/*
 * Not a distribution proof — with six hues and a hash, collisions are expected and fine. This
 * only catches the failure that would matter: a hash that ignores most of its input and paints
 * a whole workspace one colour.
 */
test("a spread of tag names does not collapse onto a single hue", () => {
  const names = Array.from({ length: 60 }, (_, index) => `tag-${index}`);
  const used = new Set(names.map(tagHue));

  assert.ok(used.size >= 4, `expected several hues in use, got ${used.size}`);
});
