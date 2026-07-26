import assert = require("node:assert/strict");
import { test } from "node:test";
import {
  MARKDOWN_ASSOCIATION_GLOB,
  isDefaultEditorFor,
  readEditorAssociations,
  withDefaultEditor,
  withoutDefaultEditor,
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
