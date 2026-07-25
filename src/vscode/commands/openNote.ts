import * as vscode from "vscode";
import { coerceUri } from "./commandUtils";
import { NOTE_EDITOR_VIEW_TYPE } from "../ids";

export async function openNote(value: unknown, rendered = false, beside = false): Promise<void> {
  const uri = coerceUri(value);
  if (!uri) {
    return;
  }

  if (rendered) {
    await vscode.commands.executeCommand("vscode.openWith", uri, NOTE_EDITOR_VIEW_TYPE, {
      preview: false,
      viewColumn: beside ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active,
    });
    return;
  }

  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(document, {
    preview: false,
    viewColumn: beside ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active,
  });
}
