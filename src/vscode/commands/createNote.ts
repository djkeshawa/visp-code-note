import * as vscode from "vscode";
import { titleToFileName } from "../../domain/normalization";
import { normalizeWorkspaceRelativeFolder } from "../../application/workspacePath";
import { conflictingNote, validateNoteTitle } from "../../application/noteTitle";
import {
  noteFolderChoices,
  rootRelativeNotePaths,
  validateNoteFolder,
} from "../../application/noteFolders";
import { isIndexableMarkdown } from "../../indexing/discovery";
import type { CommandIndex } from "./contracts";
import { pickWorkspaceFolder, uriExists } from "./commandUtils";
import { openNote } from "./openNote";

const NEW_FOLDER = "$(new-folder) New folder…";

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

  const settings = vscode.workspace.getConfiguration("vispNotes", folder.uri);
  const configuredFolder = normalizeWorkspaceRelativeFolder(
    settings.get<string>("notesFolder", "notes"),
  );
  /*
   * A caller that supplied the title has already decided everything about the note — that is
   * `createMissingNote` resolving a wiki link, which has a path in mind and cannot answer a
   * prompt. Only a note the reader asked for by hand gets asked where it goes.
   */
  const chosenFolder = suggestedTitle === undefined && settings.get<boolean>("newNote.askFolder", true)
    ? await pickNoteFolder(index, folder, configuredFolder)
    : configuredFolder;
  if (chosenFolder === undefined) return;

  const parent = chosenFolder ? vscode.Uri.joinPath(folder.uri, chosenFolder) : folder.uri;
  /*
   * Checked before anything is written. A folder covered by `vispNotes.exclude` happily holds
   * a Markdown file; the file just never appears in the panel, the graph or search, which
   * reads as the note having vanished rather than as a configuration choice.
   */
  if (!isIndexableMarkdown(vscode.Uri.joinPath(parent, titleToFileName(title)))) {
    void vscode.window.showErrorMessage(
      `“${chosenFolder || "the workspace root"}” is excluded from the Visp Notes index ` +
      "(vispNotes.exclude), so a note there would be invisible. Choose another folder.",
    );
    return;
  }
  await vscode.workspace.fs.createDirectory(parent);
  const content = new TextEncoder().encode(`# ${title.trim()}\n\n`);
  const uri = await createAvailableNote(parent, titleToFileName(title), content);
  await index.refresh(uri);

  const rendered = vscode.workspace
    .getConfiguration("vispNotes", uri)
    .get<boolean>("openRenderedAfterCreate", true);
  await openNote(uri, rendered);
}

/**
 * Which folder the note goes in.
 *
 * The configured folder is first, so Enter accepts it and the flow costs one keystroke more
 * than it used to. `undefined` means the pick was dismissed — which cancels the note, rather
 * than quietly falling back to the default the reader has just declined to accept.
 */
async function pickNoteFolder(
  index: CommandIndex,
  folder: vscode.WorkspaceFolder,
  configuredFolder: string,
): Promise<string | undefined> {
  // Only this root's notes, with this root's paths — `NoteRecord.path` leads with the root
  // folder's name in a multi-root workspace, which is not a place a note can be created.
  const choices = noteFolderChoices(
    rootRelativeNotePaths(index.snapshot.notes, folder.uri.path),
    configuredFolder,
  );
  const picked = await vscode.window.showQuickPick(
    [
      ...choices.map((choice) => ({
        label: choice.label,
        description: [
          choice.configured ? "default" : undefined,
          choice.count === 0 ? undefined : `${choice.count} note${choice.count === 1 ? "" : "s"}`,
        ].filter((part) => part !== undefined).join(" · "),
        folder: choice.path,
      })),
      { label: NEW_FOLDER, description: "", folder: undefined },
    ],
    { title: "New Visp Note", placeHolder: "Choose a folder for the note" },
  );
  if (picked === undefined) return undefined;
  if (picked.folder !== undefined) return picked.folder;

  const typed = await vscode.window.showInputBox({
    title: "New Visp Note",
    prompt: "Workspace-relative folder for the note",
    value: configuredFolder,
    validateInput: (value) => validateNoteFolder(value),
  });
  if (typed === undefined) return undefined;
  return normalizeWorkspaceRelativeFolder(typed);
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
