import * as vscode from "vscode";
import {
  MARKDOWN_ASSOCIATION_GLOB,
  isDefaultEditorFor,
  readEditorAssociations,
  withDefaultEditor,
  withoutDefaultEditor,
} from "../../application/editorAssociation";
import { NOTE_EDITOR_VIEW_TYPE } from "../ids";

const SECTION = "workbench";
const KEY = "editorAssociations";

export async function useVispNotesAsDefaultEditor(): Promise<void> {
  const associations = currentAssociations();
  if (isDefaultEditorFor(associations, MARKDOWN_ASSOCIATION_GLOB, NOTE_EDITOR_VIEW_TYPE)) {
    void vscode.window.showInformationMessage(
      "Visp Notes already opens Markdown files by default.",
    );
    return;
  }
  await vscode.workspace.getConfiguration(SECTION).update(
    KEY,
    withDefaultEditor(associations, MARKDOWN_ASSOCIATION_GLOB, NOTE_EDITOR_VIEW_TYPE),
    vscode.ConfigurationTarget.Global,
  );
  void vscode.window.showInformationMessage(
    workspaceStillOverrides()
      ? "Markdown files now open in Visp Notes everywhere except this workspace, which sets its own workbench.editorAssociations."
      : "Markdown files now open in Visp Notes. Use “Restore the Built-in Markdown Text Editor” to undo this.",
  );
}

export async function useTextEditorByDefault(): Promise<void> {
  const associations = currentAssociations();
  if (!isDefaultEditorFor(associations, MARKDOWN_ASSOCIATION_GLOB, NOTE_EDITOR_VIEW_TYPE)) {
    void vscode.window.showInformationMessage(
      "Markdown files already open in the built-in text editor.",
    );
    return;
  }
  await vscode.workspace.getConfiguration(SECTION).update(
    KEY,
    withoutDefaultEditor(associations, MARKDOWN_ASSOCIATION_GLOB, NOTE_EDITOR_VIEW_TYPE),
    vscode.ConfigurationTarget.Global,
  );
  void vscode.window.showInformationMessage(
    workspaceStillOverrides()
      ? "Markdown files now open in the built-in text editor, except in this workspace, which sets its own workbench.editorAssociations."
      : "Markdown files now open in the built-in text editor. Visp Notes stays available through “Reopen Editor With…”.",
  );
}

/**
 * The associations already in the scope these commands write to, and only those.
 *
 * `get` returns the merged value, so reading it and writing the result back to the global scope
 * copied whatever the open workspace had set into the user's own settings, where it then applied
 * to every other workspace they opened. `inspect` reads one scope without the others folded in.
 */
function currentAssociations(): Readonly<Record<string, string>> {
  return readEditorAssociations(
    vscode.workspace.getConfiguration(SECTION).inspect<unknown>(KEY)?.globalValue,
  );
}

/**
 * Whether a workspace-level association still decides which editor opens Markdown. The global
 * setting these commands write is the weaker of the two, so without this the command reports
 * success while the workspace goes on overriding it.
 */
function workspaceStillOverrides(): boolean {
  const scopes = vscode.workspace.getConfiguration(SECTION).inspect<unknown>(KEY);
  return [scopes?.workspaceValue, scopes?.workspaceFolderValue].some(
    (value) => value !== undefined && readEditorAssociations(value)[MARKDOWN_ASSOCIATION_GLOB] !== undefined,
  );
}
