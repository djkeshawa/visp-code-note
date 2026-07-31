import assert = require("node:assert/strict");
import { test } from "node:test";
import {
  BUILT_IN_EDITOR_VIEW_TYPE,
  MARKDOWN_ASSOCIATION_GLOB,
  isDefaultEditorFor,
  readEditorAssociations,
  withDefaultEditor,
  withoutDefaultEditor,
  workspaceAssociationFor,
  workspacePinContradicts,
} from "../../src/application/editorAssociation";
import { NOTE_EDITOR_VIEW_TYPE } from "../../src/vscode/ids";

test("reads only string associations from untrusted settings values", () => {
  assert.deepEqual(readEditorAssociations(undefined), {});
  assert.deepEqual(readEditorAssociations([]), {});
  assert.deepEqual(readEditorAssociations("*.md"), {});
  assert.deepEqual(
    readEditorAssociations({ "*.md": NOTE_EDITOR_VIEW_TYPE, "*.csv": 7 }),
    { "*.md": NOTE_EDITOR_VIEW_TYPE },
  );
});

test("opting in preserves unrelated associations", () => {
  const existing = { "*.csv": "gc-excelviewer-csv-editor" };

  const next = withDefaultEditor(existing, MARKDOWN_ASSOCIATION_GLOB, NOTE_EDITOR_VIEW_TYPE);

  assert.deepEqual(next, {
    "*.csv": "gc-excelviewer-csv-editor",
    "*.md": NOTE_EDITOR_VIEW_TYPE,
  });
  assert.deepEqual(existing, { "*.csv": "gc-excelviewer-csv-editor" });
  assert.ok(isDefaultEditorFor(next, MARKDOWN_ASSOCIATION_GLOB, NOTE_EDITOR_VIEW_TYPE));
});

test("opting out keeps unrelated associations and clears an empty setting", () => {
  assert.deepEqual(
    withoutDefaultEditor(
      { "*.md": NOTE_EDITOR_VIEW_TYPE, "*.csv": "gc-excelviewer-csv-editor" },
      MARKDOWN_ASSOCIATION_GLOB,
      NOTE_EDITOR_VIEW_TYPE,
    ),
    { "*.csv": "gc-excelviewer-csv-editor" },
  );
  assert.equal(
    withoutDefaultEditor(
      { "*.md": NOTE_EDITOR_VIEW_TYPE },
      MARKDOWN_ASSOCIATION_GLOB,
      NOTE_EDITOR_VIEW_TYPE,
    ),
    undefined,
  );
  assert.equal(
    withoutDefaultEditor({}, MARKDOWN_ASSOCIATION_GLOB, NOTE_EDITOR_VIEW_TYPE),
    undefined,
  );
});

test("an association owned by another editor is never removed", () => {
  const associations = { "*.md": "some.other.editor" };

  assert.equal(
    isDefaultEditorFor(associations, MARKDOWN_ASSOCIATION_GLOB, NOTE_EDITOR_VIEW_TYPE),
    false,
  );
  assert.deepEqual(
    withoutDefaultEditor(associations, MARKDOWN_ASSOCIATION_GLOB, NOTE_EDITOR_VIEW_TYPE),
    associations,
  );
});

test("a workspace pinning the same editor is not an exception to it", () => {
  /*
   * The first version of this check tested only whether the workspace set *some* association for
   * Markdown, so a workspace pinning the very editor the command had just made the default was
   * reported as an exception to it — and so was a workspace pinning the built-in editor right
   * after the user asked for the built-in editor. Both told the user the opposite of the truth.
   */
  const workspacePinsVisp = { "*.md": NOTE_EDITOR_VIEW_TYPE };
  const workspacePinsBuiltIn = { "*.md": BUILT_IN_EDITOR_VIEW_TYPE };

  const association = (value: unknown): string | undefined =>
    workspaceAssociationFor(MARKDOWN_ASSOCIATION_GLOB, undefined, value);

  // Agreeing with the command is not a contradiction.
  assert.equal(workspacePinContradicts(association(workspacePinsVisp), NOTE_EDITOR_VIEW_TYPE), false);
  assert.equal(
    workspacePinContradicts(association(workspacePinsBuiltIn), BUILT_IN_EDITOR_VIEW_TYPE),
    false,
  );

  // Disagreeing with it is.
  assert.equal(
    workspacePinContradicts(association(workspacePinsBuiltIn), NOTE_EDITOR_VIEW_TYPE),
    true,
  );
  assert.equal(workspacePinContradicts(association(workspacePinsVisp), BUILT_IN_EDITOR_VIEW_TYPE), true);

  // A workspace that says nothing about Markdown never contradicts anything.
  assert.equal(workspacePinContradicts(association(undefined), NOTE_EDITOR_VIEW_TYPE), false);
  assert.equal(workspacePinContradicts(association({ "*.txt": "other" }), NOTE_EDITOR_VIEW_TYPE), false);
});

test("the folder scope wins over the workspace scope", () => {
  assert.equal(
    workspaceAssociationFor(MARKDOWN_ASSOCIATION_GLOB, { "*.md": "folder" }, { "*.md": "workspace" }),
    "folder",
  );
  assert.equal(
    workspaceAssociationFor(MARKDOWN_ASSOCIATION_GLOB, { "*.txt": "folder" }, { "*.md": "workspace" }),
    "workspace",
  );
});
