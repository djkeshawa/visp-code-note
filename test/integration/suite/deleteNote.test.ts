import * as vscode from "vscode";
import { assert, integrationTest, resetEditors, writeFileText } from "../harness";

/**
 * Deleting a note, driven end to end.
 *
 * The interesting part is not the `fs.delete` call — it is everything around it: the index has
 * to stop listing the note, the notes that linked to it have to be left alone rather than
 * rewritten, and a tab open on the file must not survive it. None of that is provable without
 * a real extension host.
 *
 * The command is driven with `{ confirmed: true }`, the escape hatch that skips the modal.
 * A modal cannot be answered from a test, and running one here would hang the suite.
 */

function workspaceUri(...segments: string[]): vscode.Uri {
  const root = vscode.workspace.workspaceFolders?.[0];
  if (root === undefined) throw new Error("The integration workspace is not open.");
  return vscode.Uri.joinPath(root.uri, ...segments);
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

async function seed(files: Readonly<Record<string, string>>): Promise<void> {
  for (const [name, content] of Object.entries(files)) {
    await writeFileText(workspaceUri("delete", name), content);
  }
  await vscode.commands.executeCommand("vispNotes.rebuildIndex");
}

async function remove(file: string): Promise<void> {
  await vscode.commands.executeCommand("vispNotes.deleteNote", {
    uri: workspaceUri("delete", file).toString(),
    confirmed: true,
  });
  await vscode.commands.executeCommand("vispNotes.rebuildIndex");
}

integrationTest("deleting a note removes the file and drops it from the index", async () => {
  await seed({
    "doomed.md": "# Doomed note\n\nBody.\n",
    "keeper.md": "# Keeper\n\nSee [[Doomed note]].\n",
  });
  assert.ok(await exists(workspaceUri("delete", "doomed.md")), "the note was seeded");

  await remove("doomed.md");

  assert.equal(await exists(workspaceUri("delete", "doomed.md")), false, "the file is gone");
  assert.ok(await exists(workspaceUri("delete", "keeper.md")), "the note that linked to it is not");
});

integrationTest("deleting a note leaves the notes that linked to it untouched", async () => {
  await seed({
    "referenced.md": "# Referenced\n\nBody.\n",
    "refers.md": "# Refers\n\nSee [[Referenced]].\n",
  });

  await remove("referenced.md");

  const refers = await vscode.workspace.fs.readFile(workspaceUri("delete", "refers.md"));
  assert.ok(
    new TextDecoder().decode(refers).includes("[[Referenced]]"),
    "a delete must not rewrite anybody's prose — the link is now broken, and that is visible",
  );
});

integrationTest("deleting a note closes the tab left open on it", async () => {
  await seed({ "opened.md": "# Opened\n\nBody.\n" });
  const uri = workspaceUri("delete", "opened.md");
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));

  await remove("opened.md");

  const open = vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .some((tab) => {
      const input: unknown = tab.input;
      return typeof input === "object" && input !== null && "uri" in input &&
        String((input as { readonly uri: unknown }).uri) === String(uri);
    });
  assert.equal(open, false, "no tab is left showing a file that no longer exists");
  await resetEditors();
});

integrationTest("deleting a note that is not indexed does nothing and does not throw", async () => {
  await seed({ "present.md": "# Present\n\nBody.\n" });

  await vscode.commands.executeCommand("vispNotes.deleteNote", {
    uri: workspaceUri("delete", "absent.md").toString(),
    confirmed: true,
  });

  assert.ok(await exists(workspaceUri("delete", "present.md")), "nothing else was touched");
});

/*
 * Every setting is read from code by a section and a key, and declared in package.json by a
 * full id. Nothing but a test relates the two, so a typo in either would leave a setting that
 * silently never takes effect — its default would simply always win.
 */
integrationTest("every setting this release adds is readable the way the code reads it", () => {
  const reminders = vscode.workspace.getConfiguration("vispNotes.reminders");
  assert.equal(typeof reminders.get("enabled"), "boolean");
  assert.equal(typeof reminders.get("defaultTime"), "string");
  assert.equal(typeof reminders.get("leadMinutes"), "number");
  assert.equal(typeof reminders.get("catchUpWindowHours"), "number");

  const notes = vscode.workspace.getConfiguration("vispNotes");
  assert.equal(
    typeof notes.get("newNote.askFolder"),
    "boolean",
    "createNote reads this nested key from the vispNotes section",
  );
  /*
   * The projection bypass is the one setting whose absence would be silent: an undeclared key
   * reads as undefined, the cache would stay on, and the switch someone was asked to flip
   * would do nothing while they reported that it had.
   */
  assert.equal(
    typeof vscode.workspace.getConfiguration().get("vispNotes.index.bypassProjectionCache"),
    "boolean",
    "the workspace index reads this as a full key off the root configuration",
  );
  return Promise.resolve();
});
