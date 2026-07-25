import * as vscode from "vscode";
import type { OffsetRange } from "../domain/models";

export function toRange(document: vscode.TextDocument, range: OffsetRange): vscode.Range {
  return new vscode.Range(document.positionAt(range.start), document.positionAt(range.end));
}

export async function revealOffset(uri: vscode.Uri, offset: number): Promise<void> {
  const document = await vscode.workspace.openTextDocument(uri);
  const position = document.positionAt(Math.min(Math.max(offset, 0), document.getText().length));
  const editor = await vscode.window.showTextDocument(document, { preview: false });
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}
