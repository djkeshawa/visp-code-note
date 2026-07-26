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
    "Markdown files now open in Visp Notes. Use “Restore the Built-in Markdown Text Editor” to undo this.",
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
    "Markdown files now open in the built-in text editor. Visp Notes stays available through “Reopen Editor With…”.",
  );
}

function currentAssociations(): Readonly<Record<string, string>> {
  return readEditorAssociations(
    vscode.workspace.getConfiguration(SECTION).get<unknown>(KEY),
  );
}
