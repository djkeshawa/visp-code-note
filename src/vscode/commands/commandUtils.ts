import * as vscode from "vscode";
import type { NoteRecord } from "../../domain/models";

export async function pickWorkspaceFolder(): Promise<vscode.WorkspaceFolder | undefined> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length < 2) {
    return folders[0];
  }

  const picked = await vscode.window.showQuickPick(
    folders.map((folder) => ({ label: folder.name, description: folder.uri.fsPath, folder })),
    { placeHolder: "Choose a workspace folder for the note" },
  );
  return picked?.folder;
}

export async function pickNote(
  notes: readonly NoteRecord[],
  placeHolder: string,
): Promise<NoteRecord | undefined> {
  const picked = await vscode.window.showQuickPick(
    notes.map((note) => ({
      label: note.title,
      description: note.path,
      detail: note.tags.length > 0 ? note.tags.map((tag) => `#${tag}`).join(" ") : undefined,
      note,
    })),
    { placeHolder, matchOnDescription: true, matchOnDetail: true },
  );
  return picked?.note;
}

export function activeMarkdownUri(): vscode.Uri | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== "markdown") {
    return undefined;
  }
  return editor.document.uri;
}

export function coerceUri(value: unknown): vscode.Uri | undefined {
  if (value instanceof vscode.Uri) {
    return value;
  }
  if (typeof value === "string") {
    return vscode.Uri.parse(value);
  }
  if (isUriCarrier(value)) {
    return value.uri instanceof vscode.Uri ? value.uri : vscode.Uri.parse(value.uri);
  }
  if (isNoteCarrier(value)) {
    return vscode.Uri.parse(value.note.uri);
  }
  return undefined;
}

export async function uriExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch (error) {
    if (error instanceof vscode.FileSystemError && error.code === "FileNotFound") {
      return false;
    }
    throw error;
  }
}

function isUriCarrier(value: unknown): value is { readonly uri: vscode.Uri | string } {
  return typeof value === "object" && value !== null && "uri" in value;
}

function isNoteCarrier(value: unknown): value is { readonly note: { readonly uri: string } } {
  if (typeof value !== "object" || value === null || !("note" in value)) {
    return false;
  }
  const note = value.note;
  return typeof note === "object" && note !== null && "uri" in note && typeof note.uri === "string";
}
