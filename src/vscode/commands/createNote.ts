import * as vscode from "vscode";
import { titleToFileName } from "../../domain/normalization";
import { normalizeWorkspaceRelativeFolder } from "../../application/workspacePath";
import { conflictingNote, validateNoteTitle } from "../../application/noteTitle";
import type { CommandIndex } from "./contracts";
import { pickWorkspaceFolder, uriExists } from "./commandUtils";
import { openNote } from "./openNote";

export async function createNote(index: CommandIndex, suggestedTitle?: string): Promise<void> {
  const folder = await pickWorkspaceFolder();
  if (!folder) {
    void vscode.window.showInformationMessage("Open a workspace folder before creating a note.");
    return;
  }

  const title = suggestedTitle ?? await vscode.window.showInputBox({
      title: "New Visp Note",
      prompt: "Enter a note title",
      validateInput: (value) => validateTitleForIndex(index, value),
    });
  if (!title?.trim() || validateTitleForIndex(index, title)) {
    return;
  }

  const configuredFolder = normalizeWorkspaceRelativeFolder(
    vscode.workspace.getConfiguration("vispNotes", folder.uri).get<string>("notesFolder", "notes"),
  );
  const parent = configuredFolder ? vscode.Uri.joinPath(folder.uri, configuredFolder) : folder.uri;
  await vscode.workspace.fs.createDirectory(parent);
  const content = new TextEncoder().encode(`# ${title.trim()}\n\n`);
  const uri = await createAvailableNote(parent, titleToFileName(title), content);
  await index.refresh(uri);

  const rendered = vscode.workspace
    .getConfiguration("vispNotes", uri)
    .get<boolean>("openRenderedAfterCreate", true);
  await openNote(uri, rendered);
}

function validateTitleForIndex(index: CommandIndex, title: string): string | undefined {
  const invalid = validateNoteTitle(title);
  if (invalid) {
    return invalid;
  }
  const conflict = conflictingNote(index.snapshot.notes, title);
  return conflict ? `“${title.trim()}” conflicts with ${conflict.path}.` : undefined;
}

async function createAvailableNote(
  parent: vscode.Uri,
  fileName: string,
  contents: Uint8Array,
): Promise<vscode.Uri> {
  const extensionIndex = fileName.toLocaleLowerCase().endsWith(".md") ? fileName.length - 3 : fileName.length;
  const stem = fileName.slice(0, extensionIndex);
  for (let suffix = 1; ; suffix += 1) {
    const candidateName = suffix === 1 ? fileName : `${stem} ${suffix}.md`;
    const candidate = vscode.Uri.joinPath(parent, candidateName);
    if (await uriExists(candidate)) continue;

    const edit = new vscode.WorkspaceEdit();
    edit.createFile(candidate, { overwrite: false, ignoreIfExists: false, contents });
    if (await vscode.workspace.applyEdit(edit)) return candidate;
    if (!(await uriExists(candidate))) {
      throw new Error(`VS Code could not create ${candidate.fsPath}.`);
    }
  }
}
