import * as vscode from "vscode";
import { assert, integrationTest, readFileText, resetEditors, waitFor, writeFileText } from "../harness";
import { saveOutcome } from "../../../src/application/saveOutcome";

/**
 * Saving a note, through the real thing.
 *
 * The unit suite proves the *decision* is right — given what the save reported, was that a
 * failure. It cannot prove the input to that decision, because the input is whatever VS Code
 * actually returns from `TextDocument.save()`, and that is exactly what the shipped bug got
 * wrong: `save()` answers `false` for a document with nothing to write, and reading that as a
 * failure raised "VS Code could not save the note." over a note already safe on disk.
 *
 * These run in the extension host so the answer comes from VS Code rather than from a reading
 * of its documentation.
 */

function workspaceUri(...segments: string[]): vscode.Uri {
  const root = vscode.workspace.workspaceFolders?.[0];
  if (root === undefined) throw new Error("The integration workspace is not open.");
  return vscode.Uri.joinPath(root.uri, ...segments);
}

async function openNote(name: string, content: string): Promise<vscode.TextDocument> {
  const uri = workspaceUri("notes", name);
  await writeFileText(uri, content);
  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(document);
  return document;
}

/** Types into the open document, leaving it unsaved. */
async function edit(document: vscode.TextDocument, text: string): Promise<void> {
  const edit = new vscode.WorkspaceEdit();
  edit.insert(document.uri, new vscode.Position(document.lineCount, 0), text);
  assert.ok(await vscode.workspace.applyEdit(edit), "the test edit was applied");
}

integrationTest("saving a note with unsaved changes writes it to disk", async () => {
  const document = await openNote("save-dirty.md", "# Save\n");
  await edit(document, "\nA new line.\n");
  assert.equal(document.isDirty, true, "the note has something to write");

  const reportedSaved = await document.save();

  assert.equal(
    saveOutcome(true, reportedSaved, document.isDirty),
    "written",
    "a note with changes is written",
  );
  await waitFor("the new line to reach disk", async () =>
    (await readFileText(document.uri)).includes("A new line."));
  await resetEditors();
});

/*
 * The reported bug, reproduced against real VS Code. Pressing Ctrl+S on a note nobody has
 * edited must not say the note could not be saved.
 */
integrationTest("saving a note with nothing unsaved is not reported as a failure", async () => {
  const document = await openNote("save-clean.md", "# Clean\n");
  assert.equal(document.isDirty, false, "nothing has been typed into this note");

  const reportedSaved = await document.save();

  /*
   * What `save()` answers for an unedited note is VS Code's own business, and asking it here
   * settled a question the unit tests could not: it reports `true`, having written nothing.
   * That is worth knowing — it rules out "the note was clean" as the cause of a reader seeing
   * "could not save", which the documented contract had made look likely.
   *
   * The value is deliberately not pinned, because it has differed across versions and this
   * suite should not fail when it changes. What must hold either way is below.
   */
  assert.equal(document.isDirty, false, "the note is still clean afterwards");
  assert.notEqual(
    saveOutcome(false, reportedSaved, document.isDirty),
    "failed",
    `an unedited note is never a failed save (save() returned ${String(reportedSaved)})`,
  );
  assert.equal(await readFileText(document.uri), "# Clean\n", "the note is untouched");
  await resetEditors();
});

/*
 * The way a reader actually meets the bug: save, then save again — the second press has
 * nothing left to write.
 */
integrationTest("pressing save twice in a row does not fail the second time", async () => {
  const document = await openNote("save-twice.md", "# Twice\n");
  await edit(document, "\nEdited once.\n");

  const first = await document.save();
  assert.equal(saveOutcome(true, first, document.isDirty), "written", "the first save wrote");

  const hadUnsavedChanges = document.isDirty;
  const second = await document.save();
  assert.notEqual(
    saveOutcome(hadUnsavedChanges, second, document.isDirty),
    "failed",
    "the second press has nothing to write and is not a failure",
  );
  await resetEditors();
});

integrationTest("the note editor opens a Markdown file without error", async () => {
  const uri = workspaceUri("notes", "save-editor.md");
  await writeFileText(uri, "# Editor\n\n- [ ] a task\n");

  await vscode.commands.executeCommand("vscode.openWith", uri, "vispNotes.noteEditor");
  /*
   * Identified by what the tab holds rather than by its label, which VS Code derives from the
   * editor and does not promise to be the file name.
   */
  await waitFor("the note editor to own a tab for this file", () =>
    vscode.window.tabGroups.all.some((group) => group.tabs.some((tab) =>
      tab.input instanceof vscode.TabInputCustom &&
      tab.input.viewType === "vispNotes.noteEditor" &&
      tab.input.uri.toString() === uri.toString())));

  assert.equal(await readFileText(uri), "# Editor\n\n- [ ] a task\n", "opening changed nothing");
  await resetEditors();
});
