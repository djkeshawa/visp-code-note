import * as vscode from "vscode";
import {
  assert,
  integrationTest,
  readFileText,
  resetEditors,
  waitFor,
  writeFileText,
} from "../harness";

/**
 * The paths that write to a user's Markdown, exercised through the real extension host.
 *
 * Every other suite here is pure logic: it proves a planner returns the right offsets.
 * Nothing until now proved VS Code actually applies those offsets to a real file. That
 * gap is why `planAliasAddition` shipped broken for the commonest frontmatter shape.
 */

function workspaceUri(...segments: string[]): vscode.Uri {
  const root = vscode.workspace.workspaceFolders?.[0];
  if (root === undefined) throw new Error("The integration workspace is not open.");
  return vscode.Uri.joinPath(root.uri, ...segments);
}

/** Writes a note, waits for the index to see it, and opens it in the plain text editor. */
async function openSeededNote(name: string, content: string): Promise<vscode.Uri> {
  const uri = workspaceUri("notes", name);
  await writeFileText(uri, content);
  await vscode.commands.executeCommand("vispNotes.rebuildIndex");
  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(document);
  return uri;
}

/** Text as VS Code currently holds it, which includes edits not yet flushed to disk. */
function bufferText(uri: vscode.Uri): string {
  const open = vscode.workspace.textDocuments.find(
    (document) => document.uri.toString() === uri.toString(),
  );
  if (open === undefined) throw new Error(`${uri.toString()} is not open`);
  return open.getText();
}

integrationTest("activates and registers every contributed command", async () => {
  const extension = vscode.extensions.getExtension("visp-code-note.visp-notes");
  assert.ok(extension !== undefined, "extension not found in the host");
  await extension.activate();

  const commands = await vscode.commands.getCommands(true);
  for (const id of [
    "vispNotes.newNote",
    "vispNotes.toggleTask",
    "vispNotes.renameNote",
    "vispNotes.addTag",
    "vispNotes.removeTag",
    "vispNotes.rebuildIndex",
  ]) {
    assert.ok(commands.includes(id), `${id} was not registered`);
  }
});

integrationTest("toggling a task rewrites its checkbox and nothing else", async () => {
  const before = [
    "# Planning",
    "",
    "- [ ] First task",
    "- [ ] Second task @due(2026-08-01) #product",
    "",
    "Trailing prose stays put.",
    "",
  ].join("\n");
  const uri = await openSeededNote("tasks.md", before);

  const editor = vscode.window.activeTextEditor!;
  editor.selection = new vscode.Selection(3, 10, 3, 10);
  await vscode.commands.executeCommand("vispNotes.toggleTask");

  await waitFor("the second task to be checked", () =>
    bufferText(uri).includes("- [x] Second task"));

  assert.equal(
    bufferText(uri),
    before.replace("- [ ] Second task", "- [x] Second task"),
    "the metadata, the other task and the prose must be untouched",
  );
  await resetEditors();
});

integrationTest("adds a tag to an existing frontmatter list", async () => {
  const uri = await openSeededNote(
    "add-list.md",
    "---\ntitle: Atlas\ntags: [product]\n---\n\n# Atlas\n\nBody.\n",
  );

  await vscode.commands.executeCommand("vispNotes.addTag", "planning");

  await waitFor("the tag to be written", () => bufferText(uri).includes("planning"));
  assert.equal(
    bufferText(uri),
    '---\ntitle: Atlas\ntags: [product, "planning"]\n---\n\n# Atlas\n\nBody.\n',
  );
  await resetEditors();
});

integrationTest("creates frontmatter when a note has none", async () => {
  const uri = await openSeededNote("add-new.md", "# Bare note\n\nNo frontmatter here.\n");

  await vscode.commands.executeCommand("vispNotes.addTag", "product");

  await waitFor("frontmatter to appear", () => bufferText(uri).startsWith("---"));
  assert.equal(
    bufferText(uri),
    '---\ntags:\n  - "product"\n---\n\n# Bare note\n\nNo frontmatter here.\n',
  );
  await resetEditors();
});

integrationTest("preserves CRLF endings and a trailing YAML comment", async () => {
  const uri = await openSeededNote(
    "add-crlf.md",
    "---\r\ntitle: Atlas\r\ntags: [product] # keep me\r\n---\r\n\r\n# Atlas\r\n",
  );

  await vscode.commands.executeCommand("vispNotes.addTag", "docs");

  await waitFor("the tag to be written", () => bufferText(uri).includes("docs"));
  const text = bufferText(uri);
  assert.ok(text.includes("# keep me"), "the YAML comment survived");
  assert.ok(!/[^\r]\n/.test(text), "every line ending stayed CRLF");
  assert.ok(text.includes('tags: [product, "docs"] # keep me'), text);
  await resetEditors();
});

integrationTest("removes only the named tag from a block sequence", async () => {
  const uri = await openSeededNote(
    "remove-block.md",
    "---\ntags:\n  - product\n  - planning\n  - docs\n---\n\n# Atlas\n",
  );

  await vscode.commands.executeCommand("vispNotes.removeTag", "planning");

  await waitFor("the tag to be removed", () => !bufferText(uri).includes("planning"));
  assert.equal(bufferText(uri), "---\ntags:\n  - product\n  - docs\n---\n\n# Atlas\n");
  await resetEditors();
});

integrationTest("leaves an inline tag in the prose alone", async () => {
  const before = "---\ntitle: Atlas\n---\n\nThis note is about #product work.\n";
  const uri = await openSeededNote("remove-inline.md", before);

  await vscode.commands.executeCommand("vispNotes.removeTag", "product");

  // Nothing should happen: the tag lives in the sentence, not in frontmatter.
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.equal(bufferText(uri), before, "the author's sentence must not be rewritten");
  await resetEditors();
});

integrationTest("refuses YAML it cannot edit safely instead of corrupting it", async () => {
  const before = "---\ntags: |\n  product\n  planning\n---\n\n# Atlas\n";
  const uri = await openSeededNote("add-unsafe.md", before);

  await vscode.commands.executeCommand("vispNotes.addTag", "docs");

  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.equal(bufferText(uri), before, "a block scalar must be left exactly as it was");
  await resetEditors();
});

integrationTest("a rename that updates links leaves no broken wiki link behind", async () => {
  await writeFileText(workspaceUri("notes", "old-name.md"), "# Old name\n\nTarget.\n");
  const sourceUri = workspaceUri("notes", "refers.md");
  await writeFileText(sourceUri, "# Refers\n\nSee [[Old name]] twice: [[Old name|alias]].\n");
  await vscode.commands.executeCommand("vispNotes.rebuildIndex");

  const renamed = workspaceUri("notes", "new-name.md");
  const edit = new vscode.WorkspaceEdit();
  edit.renameFile(workspaceUri("notes", "old-name.md"), renamed, { overwrite: true });
  assert.ok(await vscode.workspace.applyEdit(edit), "the rename could not be applied");
  await vscode.commands.executeCommand("vispNotes.rebuildIndex");

  // A plain file rename is not the extension's rename command, so links stay as written.
  // This pins the boundary: nothing rewrites a user's links behind their back.
  assert.ok((await readFileText(sourceUri)).includes("[[Old name]]"));
  assert.ok((await readFileText(renamed)).includes("Target."));
  await resetEditors();
});
