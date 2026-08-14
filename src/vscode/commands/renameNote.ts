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

/**
 * A fully specified rename, supplied as the command argument.
 *
 * Passing one skips the title prompt, the mode picker, the diff preview and the
 * confirmation modal: the caller has already made every decision those ask about. This is
 * what makes the rename path drivable from a keybinding, another extension, or the
 * integration suite — three interactive gates cannot be answered from a test.
 */
export interface RenameNoteRequest {
  readonly uri?: unknown;
  readonly title: string;
  readonly mode: RenameMode;
}

const RENAME_MODES: readonly RenameMode[] = ["updateLinks", "preserveAlias", "pathOnly"];

function asRenameRequest(value: unknown): RenameNoteRequest | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as Partial<RenameNoteRequest>;
  if (typeof candidate.title !== "string") return undefined;
  return RENAME_MODES.some((mode) => mode === candidate.mode)
    ? { uri: candidate.uri, title: candidate.title, mode: candidate.mode! }
    : undefined;
}

export async function renameNote(
  index: CommandIndex,
  value?: unknown,
  showDiff?: (title: string, before: string, after: string) => Promise<void>,
): Promise<void> {
  const request = asRenameRequest(value);
  const requestedUri = request === undefined
    ? coerceUri(value)
    : request.uri === undefined ? undefined : coerceUri(request.uri);
  const uri = requestedUri ?? activeMarkdownUri();
  /*
   * One file, not the whole workspace. This ran a full rebuild — every `.md` in the workspace
   * re-discovered, re-read and re-projected — before the title prompt had even appeared, and on
   * a network drive that is seconds of nothing between the keypress and the input box, which
   * reads as a broken command. All this needs is for the note being renamed to be current.
   *
   * Every check that has to be right runs after the rebuild below, against a workspace read
   * from scratch: the note still exists, the title still does not collide, the destination is
   * still free, and the plan still matches the files. The one thing the up-front rebuild also
   * bought was that the pre-modal preview and the post-rebuild plan agreed more often; where
   * they disagree the command already stops and asks for a retry, and the retry now runs with
   * the workspace freshly read.
   */
  if (uri) await index.refresh(uri);
  const note = uri ? index.findNote(uri) : undefined;
  if (!note) {
    void vscode.window.showInformationMessage("Open an indexed Markdown note before renaming it.");
    return;
  }

  const nextTitle = request?.title ?? await vscode.window.showInputBox({
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
  if (nextTitle === undefined || nextTitle.trim() === "") {
    if (request !== undefined) throw new Error("A note title is required.");
    return;
  }
  const titleProblem = validateNoteTitle(nextTitle) ??
    (conflictingNote(index.snapshot.notes, nextTitle, note.uri)
      ? "This title or alias is already used by another note."
      : undefined);
  if (titleProblem !== undefined) {
    // Interactively this means the prompt was dismissed or corrected; a caller that passed
    // an explicit title needs to hear why nothing happened.
    if (request !== undefined) throw new Error(titleProblem);
    return;
  }
  const requestedTitle = nextTitle.trim();

  const mode = request?.mode ?? await pickRenameMode();
  if (!mode) {
    return;
  }

  if (mode !== "pathOnly" && requestedTitle === note.title) {
    return;
  }

  const nextUri = siblingUri(vscode.Uri.parse(note.uri), titleToFileName(requestedTitle));
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
  const replacements = linkReplacements(index, note, requestedTitle, nextPath, mode);
  const preview = await prepareRenameTransaction(
    note,
    nextUri,
    requestedTitle,
    mode,
    replacements,
    intermediateUri,
  );
  if (request === undefined) {
    if (preview.before !== undefined && preview.after !== undefined && showDiff) {
      await showDiff("Visp Notes: Rename Preview", preview.before, preview.after);
    }
    if (!(await confirmRename(
      note,
      requestedTitle,
      nextUri,
      mode,
      replacements.map((item) => item.uri),
    ))) {
      return;
    }
  }

  /*
   * The wait the user actually has to sit through — a full rebuild, every affected file opened,
   * and the edits written — narrated where they are looking. It used to happen behind a status
   * bar item in the far corner, after they had pressed Apply Rename and had every reason to
   * think the work was already done.
   */
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "Updating links…" },
    async () => {
      await index.rebuild();
      const currentNote = index.findNote(note.uri);
      if (!currentNote) throw new Error("The note moved or was deleted after the rename preview.");
      if (conflictingNote(index.snapshot.notes, requestedTitle, currentNote.uri)) {
        throw new Error("The requested title now conflicts with another note.");
      }
      if (pathChanged && await destinationConflicts(previousUri, nextUri, caseOnlyRename)) {
        throw new Error(`The destination ${nextUri.fsPath} now exists.`);
      }
      const currentReplacements = linkReplacements(index, currentNote, requestedTitle, nextPath, mode);
      const transaction = await prepareRenameTransaction(
        currentNote,
        nextUri,
        requestedTitle,
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
    },
  );
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
