import * as vscode from "vscode";
import { stat } from "node:fs/promises";
import { planLinkMigration, planPathLinkMigration } from "../../application/linkMigration";
import { titleToFileName } from "../../domain/normalization";
import { conflictingNote, validateNoteTitle } from "../../application/noteTitle";
import type { NoteRecord } from "../../domain/models";
import type { CommandIndex } from "./contracts";
import { activeMarkdownUri, coerceUri, uriExists } from "./commandUtils";
import { openNote } from "./openNote";
import {
  applyRenameTransaction,
  prepareRenameTransaction,
  type RenameMode,
} from "./renameTransaction";

export async function renameNote(
  index: CommandIndex,
  value?: unknown,
  showDiff?: (title: string, before: string, after: string) => Promise<void>,
): Promise<void> {
  const uri = coerceUri(value) ?? activeMarkdownUri();
  if (uri) await index.rebuild();
  const note = uri ? index.findNote(uri) : undefined;
  if (!note) {
    void vscode.window.showInformationMessage("Open an indexed Markdown note before renaming it.");
    return;
  }

  const nextTitle = await vscode.window.showInputBox({
    title: "Rename Visp Note",
    prompt: "Enter the new note title and file name",
    value: note.title,
    valueSelection: [0, note.title.length],
    validateInput: (candidate) => {
      const invalid = validateNoteTitle(candidate);
      if (invalid) return invalid;
      const conflict = conflictingNote(index.snapshot.notes, candidate, note.uri);
      return conflict ? `This title or alias is already used by ${conflict.path}.` : undefined;
    },
  });
  if (
    !nextTitle?.trim() ||
    validateNoteTitle(nextTitle) ||
    conflictingNote(index.snapshot.notes, nextTitle, note.uri)
  ) {
    return;
  }

  const mode = await pickRenameMode();
  if (!mode) {
    return;
  }

  if (mode !== "pathOnly" && nextTitle.trim() === note.title) {
    return;
  }

  const nextUri = siblingUri(vscode.Uri.parse(note.uri), titleToFileName(nextTitle));
  const previousUri = vscode.Uri.parse(note.uri);
  const pathChanged = nextUri.toString() !== note.uri;
  if (!pathChanged && mode === "pathOnly") {
    return;
  }
  const caseOnlyRename = pathChanged && isCaseOnlyResourceRename(previousUri, nextUri);
  if (pathChanged && await destinationConflicts(previousUri, nextUri, caseOnlyRename)) {
    void vscode.window.showErrorMessage(`A note named ${nextUri.path.split("/").pop()} already exists.`);
    return;
  }
  const intermediateUri = caseOnlyRename ? await unusedIntermediateUri(previousUri) : undefined;

  const nextPath = vscode.workspace.asRelativePath(
    nextUri,
    (vscode.workspace.workspaceFolders?.length ?? 0) > 1,
  ).replace(/\\/g, "/");
  const replacements = linkReplacements(index, note, nextTitle.trim(), nextPath, mode);
  const preview = await prepareRenameTransaction(
    note,
    nextUri,
    nextTitle.trim(),
    mode,
    replacements,
    intermediateUri,
  );
  if (preview.before !== undefined && preview.after !== undefined && showDiff) {
    await showDiff("Visp Notes: Rename Preview", preview.before, preview.after);
  }
  if (!(await confirmRename(
    note,
    nextTitle.trim(),
    nextUri,
    mode,
    replacements.map((item) => item.uri),
  ))) {
    return;
  }

  await index.rebuild();
  const currentNote = index.findNote(note.uri);
  if (!currentNote) throw new Error("The note moved or was deleted after the rename preview.");
  if (conflictingNote(index.snapshot.notes, nextTitle, currentNote.uri)) {
    throw new Error("The requested title now conflicts with another note.");
  }
  if (pathChanged && await destinationConflicts(previousUri, nextUri, caseOnlyRename)) {
    throw new Error(`The destination ${nextUri.fsPath} now exists.`);
  }
  const currentReplacements = linkReplacements(index, currentNote, nextTitle.trim(), nextPath, mode);
  const transaction = await prepareRenameTransaction(
    currentNote,
    nextUri,
    nextTitle.trim(),
    mode,
    currentReplacements,
    intermediateUri,
  );
  if (preview.before !== transaction.before) {
    throw new Error("A file changed after the rename preview. Review the updated files and retry.");
  }
  await applyRenameTransaction(transaction);

  if (pathChanged) await index.move(previousUri, nextUri);
  else await index.refresh(previousUri);
  await openNote(nextUri, true);
}

function linkReplacements(
  index: CommandIndex,
  note: NoteRecord,
  nextTitle: string,
  nextPath: string,
  mode: RenameMode,
): ReturnType<typeof planLinkMigration> {
  if (mode === "pathOnly") return [];
  return mode === "preserveAlias"
    ? planPathLinkMigration(index.snapshot, note, nextTitle, nextPath)
    : planLinkMigration(index.snapshot, note, nextTitle, nextPath);
}

async function pickRenameMode(): Promise<RenameMode | undefined> {
  const picked = await vscode.window.showQuickPick(
    [
      {
        label: "Rename and update links",
        description: "Update the note title, file name, and every resolved incoming wiki link",
        mode: "updateLinks" as const,
      },
      {
        label: "Rename and preserve the old title as an alias",
        description: "Keep existing wiki links valid through YAML frontmatter",
        mode: "preserveAlias" as const,
      },
      {
        label: "Rename only the file path",
        description: "Leave the note title and all wiki links unchanged",
        mode: "pathOnly" as const,
      },
    ],
    { placeHolder: "Choose how Visp Notes should handle references" },
  );
  return picked?.mode;
}

async function confirmRename(
  note: NoteRecord,
  nextTitle: string,
  nextUri: vscode.Uri,
  mode: RenameMode,
  affectedUris: readonly string[],
): Promise<boolean> {
  const paths = [...new Set(affectedUris)]
    .map((uri) => vscode.workspace.asRelativePath(vscode.Uri.parse(uri)))
    .sort();
  const detail = [
    nextUri.toString() === note.uri
      ? `Title: ${note.title} → ${nextTitle} (file path unchanged)`
      : `${note.path} → ${vscode.workspace.asRelativePath(nextUri)}`,
    mode === "updateLinks"
      ? `${affectedUris.length} link${affectedUris.length === 1 ? "" : "s"} in ${paths.length} file${paths.length === 1 ? "" : "s"}: ${paths.join(", ") || "none"}`
      : mode === "preserveAlias"
        ? [
            `The alias “${note.title}” will be added to the note.`,
            affectedUris.length > 0
              ? `${affectedUris.length} path-based link${affectedUris.length === 1 ? "" : "s"} will also be updated.`
              : undefined,
          ].filter(Boolean).join(" ")
        : "Note contents and incoming links will not be changed.",
  ].join("\n\n");
  const confirmed = await vscode.window.showInformationMessage(
    "Preview Visp note rename",
    { modal: true, detail },
    "Apply Rename",
  );
  return confirmed === "Apply Rename";
}

function siblingUri(uri: vscode.Uri, fileName: string): vscode.Uri {
  const slash = uri.path.lastIndexOf("/");
  return uri.with({ path: `${uri.path.slice(0, slash + 1)}${fileName}` });
}

function isCaseOnlyResourceRename(previousUri: vscode.Uri, nextUri: vscode.Uri): boolean {
  return previousUri.scheme === nextUri.scheme
    && previousUri.authority === nextUri.authority
    && previousUri.path !== nextUri.path
    && previousUri.path.toLowerCase() === nextUri.path.toLowerCase();
}

async function destinationConflicts(
  previousUri: vscode.Uri,
  nextUri: vscode.Uri,
  caseOnlyRename: boolean,
): Promise<boolean> {
  if (!(await uriExists(nextUri))) return false;
  if (!caseOnlyRename) return true;
  const sameFile = await refersToSameLocalFile(previousUri, nextUri);
  return sameFile === false;
}

async function refersToSameLocalFile(
  previousUri: vscode.Uri,
  nextUri: vscode.Uri,
): Promise<boolean | undefined> {
  if (previousUri.scheme !== "file" || nextUri.scheme !== "file") return undefined;
  try {
    const [previous, next] = await Promise.all([stat(previousUri.fsPath), stat(nextUri.fsPath)]);
    return previous.dev === next.dev && previous.ino === next.ino;
  } catch {
    return undefined;
  }
}

async function unusedIntermediateUri(uri: vscode.Uri): Promise<vscode.Uri> {
  const seed = Date.now().toString(36);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = uri.with({ path: `${uri.path}.visp-rename-${seed}-${attempt}` });
    if (!(await uriExists(candidate))) return candidate;
  }
  throw new Error("Visp Notes could not reserve a temporary path for the case-only rename.");
}
