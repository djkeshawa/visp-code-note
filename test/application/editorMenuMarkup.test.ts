import assert = require("node:assert/strict");
import { test } from "node:test";
import { EDITOR_BODY } from "../../src/ui/pageBodies";
import { INLINE_MARKS } from "../../src/webview/editor/inlineMarks";

/**
 * The overflow menu's markup, against what the page's script insists on finding in it.
 *
 * `editor.ts` resolves its elements at module load and throws when one is missing, so a
 * renamed id here does not degrade the menu — it takes the whole note editor down before a
 * single note is drawn. Nothing else renders this markup in a test, so nothing else would
 * notice.
 */

test("the menu holds the container the formatting keys are listed into", () => {
  assert.equal(
    EDITOR_BODY.includes('id="editor-menu-formatting"'),
    true,
    "editor.ts requires this element and throws on load without it",
  );
});

test("the hint column still carries the bindings the script fills in", () => {
  for (const binding of ["insertLink", "openLocalGraph"]) {
    assert.equal(
      EDITOR_BODY.includes(`data-binding="${binding}"`),
      true,
      `${binding} has a hint to render into but no place to render it`,
    );
  }
});

test("every formatting row can be drawn, because every mark names a codicon", () => {
  for (const mark of INLINE_MARKS) {
    assert.notEqual(mark.icon, "", `${mark.label} has no glyph`);
    assert.equal(
      /^[a-z][a-z0-9-]*$/.test(mark.icon),
      true,
      `${mark.label} names ${JSON.stringify(mark.icon)}, which is not a codicon name`,
    );
  }
});
