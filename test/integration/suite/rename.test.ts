import * as vscode from "vscode";
import { assert, integrationTest, readFileText, resetEditors, writeFileText } from "../harness";

/**
 * The rename transaction, driven end to end.
 *
 * This is the path where `planAliasAddition` shipped broken: preserving the old title as an
 * alias throws on `aliases:\n  - Something\n---`, the shape that option itself produces on
 * a second rename. Unit tests now cover the planner, but only a real host proves the file
 * is renamed, the links are rewritten, and the two stay consistent with each other.
 */

function workspaceUri(...segments: string[]): vscode.Uri {
  const root = vscode.workspace.workspaceFolders?.[0];
  if (root === undefined) throw new Error("The integration workspace is not open.");
  return vscode.Uri.joinPath(root.uri, ...segments);
}

async function seed(files: Readonly<Record<string, string>>): Promise<void> {
  for (const [name, content] of Object.entries(files)) {
    await writeFileText(workspaceUri("rename", name), content);
  }
  await vscode.commands.executeCommand("vispNotes.rebuildIndex");
}

async function rename(file: string, title: string, mode: string): Promise<void> {
  await vscode.commands.executeCommand("vispNotes.renameNote", {
    uri: workspaceUri("rename", file).toString(),
    title,
    mode,
  });
  await vscode.commands.executeCommand("vispNotes.rebuildIndex");
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

integrationTest("rename with link updates rewrites every incoming wiki link", async () => {
  await seed({
    "target.md": "# Target note\n\nBody.\n",
    "refers.md": "# Refers\n\nSee [[Target note]] and [[Target note|an alias]].\n",
    "other.md": "# Other\n\nAlso [[Target note#Body]].\n",
  });

  await rename("target.md", "Renamed note", "updateLinks");

  assert.ok(await exists(workspaceUri("rename", "Renamed note.md")), "the file was renamed");
  assert.equal(await exists(workspaceUri("rename", "target.md")), false, "the old file is gone");

  const refers = await readFileText(workspaceUri("rename", "refers.md"));
  assert.ok(refers.includes("[[Renamed note]]"), refers);
  assert.ok(refers.includes("[[Renamed note|an alias]]"), "the alias text is preserved");
  assert.ok(!refers.includes("[[Target note"), "no stale link is left behind");

  const other = await readFileText(workspaceUri("rename", "other.md"));
  assert.ok(other.includes("[[Renamed note#Body]]"), "the heading anchor survives");
  await resetEditors();
});

integrationTest("rename preserving an alias keeps existing links resolving", async () => {
  await seed({
    "aliased.md": "# Aliased note\n\nBody.\n",
    "points.md": "# Points\n\nSee [[Aliased note]].\n",
  });

  await rename("aliased.md", "New aliased name", "preserveAlias");

  const renamed = await readFileText(workspaceUri("rename", "New aliased name.md"));
  assert.ok(renamed.includes("aliases:"), renamed);
  assert.ok(renamed.includes("Aliased note"), "the old title became an alias");

  // The point of this mode: the link is deliberately left alone and still resolves.
  const points = await readFileText(workspaceUri("rename", "points.md"));
  assert.ok(points.includes("[[Aliased note]]"), "the existing link is untouched");
  await resetEditors();
});

integrationTest(
  "renaming twice with aliases appends to the sequence the first rename created",
  async () => {
    // The regression case. The first rename writes `aliases:\n  - "First name"\n---`, and
    // the second has to append to a block sequence that is the last frontmatter property —
    // which threw before the propertyTailLines fix, so this rename simply failed.
    await seed({ "first.md": "# First name\n\nBody.\n" });

    await rename("first.md", "Second name", "preserveAlias");
    const afterFirst = await readFileText(workspaceUri("rename", "Second name.md"));
    assert.ok(afterFirst.includes("First name"), afterFirst);

    await rename("Second name.md", "Third name", "preserveAlias");

    const afterSecond = await readFileText(workspaceUri("rename", "Third name.md"));
    assert.ok(afterSecond.includes("First name"), "the first alias survived");
    assert.ok(afterSecond.includes("Second name"), "the second alias was appended");
    assert.equal(
      afterSecond.match(/^aliases:/gm)?.length,
      1,
      "a second aliases key must not be created",
    );
    await resetEditors();
  },
);

integrationTest("path-only rename leaves the title and every link alone", async () => {
  await seed({
    "path-only.md": "# Path only\n\nBody.\n",
    "cites.md": "# Cites\n\nSee [[Path only]].\n",
  });

  await rename("path-only.md", "Moved file name", "pathOnly");

  assert.ok(await exists(workspaceUri("rename", "Moved file name.md")), "the file moved");
  const moved = await readFileText(workspaceUri("rename", "Moved file name.md"));
  assert.ok(moved.includes("# Path only"), "the note title is unchanged");
  assert.ok(!moved.includes("aliases:"), "no alias is added in this mode");

  const cites = await readFileText(workspaceUri("rename", "cites.md"));
  assert.ok(cites.includes("[[Path only]]"), "links are deliberately left as written");
  await resetEditors();
});

integrationTest("a rename onto an existing note is refused", async () => {
  await seed({
    "source.md": "# Source note\n\nBody.\n",
    "Occupied name.md": "# Occupied name\n\nDo not clobber me.\n",
  });

  let failed = false;
  try {
    await rename("source.md", "Occupied name", "updateLinks");
  } catch {
    failed = true;
  }

  const occupied = await readFileText(workspaceUri("rename", "Occupied name.md"));
  assert.ok(occupied.includes("Do not clobber me."), "the existing note was not overwritten");
  assert.ok(
    failed || (await exists(workspaceUri("rename", "source.md"))),
    "the rename must not silently succeed",
  );
  await resetEditors();
});

integrationTest("an invalid title tells the user instead of failing silently", async () => {
  await seed({ "valid.md": "# Valid note\n\nBody.\n" });

  // Commands report failures through an error message rather than rejecting, so the
  // observable contract is what the user is shown plus the note being left alone.
  const shown: string[] = [];
  const original = vscode.window.showErrorMessage;
  (vscode.window as unknown as Record<string, unknown>).showErrorMessage = (message: string) => {
    shown.push(message);
    return Promise.resolve(undefined);
  };
  try {
    await rename("valid.md", "   ", "updateLinks");
  } finally {
    (vscode.window as unknown as Record<string, unknown>).showErrorMessage = original;
  }

  assert.ok(shown.length > 0, "the user was told why nothing happened");
  assert.ok(shown.some((m) => m.includes("title")), shown.join(" | "));
  assert.ok(await exists(workspaceUri("rename", "valid.md")), "the note is untouched");
  assert.equal(
    await readFileText(workspaceUri("rename", "valid.md")),
    "# Valid note\n\nBody.\n",
    "its content is unchanged",
  );
  await resetEditors();
});
