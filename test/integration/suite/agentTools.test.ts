import * as vscode from "vscode";
import { assert, integrationTest, resetEditors, waitFor, writeFileText } from "../harness";

/*
 * Chat could not see a note open in the Visp Notes editor, because its "current file" is the
 * active text editor and this is a custom editor. These drive the tools the way an agent does,
 * through `vscode.lm.invokeTool`, against real VS Code.
 */
function workspaceUri(...segments: string[]): vscode.Uri {
  const root = vscode.workspace.workspaceFolders?.[0];
  if (root === undefined) throw new Error("The integration workspace is not open.");
  return vscode.Uri.joinPath(root.uri, ...segments);
}

async function ask(name: string, input: object): Promise<string> {
  const result = await vscode.lm.invokeTool(name, { input, toolInvocationToken: undefined });
  return result.content
    .map((part) => part instanceof vscode.LanguageModelTextPart ? part.value : "")
    .join("");
}

integrationTest("every Visp Notes agent tool is registered with VS Code", async () => {
  const expected = ["visp_activeNote", "visp_readNote", "visp_searchNotes", "visp_noteGraph", "visp_linkPath", "visp_listTasks"];
  await waitFor("the agent tools to register", () => {
    const names = new Set(vscode.lm.tools.map((tool) => tool.name));
    return expected.every((name) => names.has(name));
  });
});

integrationTest("the open note is found in the Visp Notes editor, with its links", async () => {
  const hub = workspaceUri("notes", "agent-hub.md");
  await writeFileText(workspaceUri("notes", "agent-spoke.md"), "# Agent spoke\n\nBack to [[Agent hub]].\n");
  await writeFileText(hub, "# Agent hub\n\nSee [[Agent spoke]].\n\n- [ ] Brief the agent @due(2026-01-01)\n");
  await vscode.commands.executeCommand("vispNotes.rebuildIndex");
  await vscode.commands.executeCommand("vscode.openWith", hub, "vispNotes.noteEditor");
  await waitFor("the note editor tab", () => {
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    return input instanceof vscode.TabInputCustom && input.uri.toString() === hub.toString();
  });

  let active = "";
  await waitFor("the open note to be described", async () =>
    (active = await ask("visp_activeNote", {})).includes("# Agent hub"));
  assert.match(active, /Path: `notes\/agent-hub\.md`/);
  assert.match(active, /\[\[Agent spoke\]\] → `notes\/agent-spoke\.md`/);
  assert.match(active, /Linked from \(1\)/);

  assert.match(await ask("visp_noteGraph", {}), /Agent hub links both ways with \*\*Agent spoke\*\*/);
  assert.match(await ask("visp_listTasks", { note: "Agent hub" }), /Brief the agent.*\*\*overdue\*\*/);
  assert.match(await ask("visp_readNote", { note: "Nothing called this" }), /No note matches/);
  await resetEditors();
});

/*
 * `vscode.lm.tools` lists every tool the manifest contributes whatever its state, so the test
 * asks the question that matters: can the tool still be called. The manifest's `when` clause
 * keeps it out of chat's tool picker as well; this proves the implementation is gone too.
 */
integrationTest("turning agent access off withdraws the tools, and turning it on restores them", async () => {
  const config = vscode.workspace.getConfiguration("vispNotes");
  const callable = async (): Promise<boolean> => {
    try {
      await vscode.lm.invokeTool("visp_searchNotes", { input: { query: "x" }, toolInvocationToken: undefined });
      return true;
    } catch {
      return false;
    }
  };
  try {
    await config.update("agents.enabled", false, vscode.ConfigurationTarget.Global);
    await waitFor("the tools to be withdrawn", async () => !(await callable()));
  } finally {
    await config.update("agents.enabled", undefined, vscode.ConfigurationTarget.Global);
  }
  await waitFor("the tools to come back", callable);
});
