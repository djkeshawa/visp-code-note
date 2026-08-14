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
  for (const binding of ["insertLink"]) {
    assert.equal(
      EDITOR_BODY.includes(`data-binding="${binding}"`),
      true,
      `${binding} has a hint to render into but no place to render it`,
    );
  }
});

/**
 * Open Local Graph's row deliberately has no hint slot.
 *
 * Its keybinding is scoped away from this window — Ctrl+Shift+G is the editor's own Find
 * Previous — so a hint here would name a key that does nothing where it is read. The row itself
 * stays: the command is one click away, it is only the key that does not reach here.
 */
test("Open Local Graph is offered without a key, because its key is scoped out of this window", () => {
  assert.equal(
    EDITOR_BODY.includes('data-command="openLocalGraph"'),
    true,
    "the command should still be reachable from the menu",
  );
  assert.equal(
    EDITOR_BODY.includes('data-binding="openLocalGraph"'),
    false,
    "a hint slot here would be filled with a key that does nothing in the note editor",
  );
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
