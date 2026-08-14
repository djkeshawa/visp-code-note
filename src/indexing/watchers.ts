import * as vscode from "vscode";
import type { IndexSnapshot } from "../domain/models";
import { isIndexableMarkdown } from "./discovery";
import { planFileRenameEdit } from "./renameMigration";
import type { FileRename } from "./renameMigration";

export type MarkdownChange =
  | { readonly kind: "upsert"; readonly uri: vscode.Uri }
  | { readonly kind: "remove"; readonly uri: vscode.Uri };

export function createIndexWatchers(
  onChange: (change: MarkdownChange) => void,
  onRebuild: () => void,
  snapshot: () => IndexSnapshot,
): readonly vscode.Disposable[] {
  const watcher = vscode.workspace.createFileSystemWatcher("**/*.md");
  const pendingTextChanges = new Map<string, NodeJS.Timeout>();
  const scheduleTextChange = (uri: vscode.Uri): void => {
    const key = uri.toString();
    const previous = pendingTextChanges.get(key);
    if (previous) {
      clearTimeout(previous);
    }
    pendingTextChanges.set(key, setTimeout(() => {
      pendingTextChanges.delete(key);
      onChange({ kind: "upsert", uri });
    }, 120));
  };
  const clearPendingChange = (uri: vscode.Uri): void => {
    const key = uri.toString();
    const pending = pendingTextChanges.get(key);
    if (pending) {
      clearTimeout(pending);
      pendingTextChanges.delete(key);
    }
  };
  const applyChange = (kind: MarkdownChange["kind"], uri: vscode.Uri): void => {
    clearPendingChange(uri);
    onChange({ kind, uri });
  };
  return [
    watcher,
    watcher.onDidCreate((uri) => {
      clearPendingChange(uri);
      onChange({ kind: "upsert", uri });
    }),
    watcher.onDidChange((uri) => {
      clearPendingChange(uri);
      onChange({ kind: "upsert", uri });
    }),
    watcher.onDidDelete((uri) => {
      clearPendingChange(uri);
      onChange({ kind: "remove", uri });
    }),
    /*
     * The valuable half of the rename story. An edit contributed here is applied by VS Code as
     * part of the rename itself — one undo step, and the links never spend a moment pointing at
     * a file that has moved.
     *
     * Three rules this handler lives under, in order of how badly breaking them hurts:
     *
     * It never asks anything. VS Code runs rename participants with a timeout and a spinner over
     * the Explorer; a modal here is a hung rename, not a question. The Rename Note command is
     * where the mode picker and the confirmation live, and it stays that way.
     *
     * It is all or nothing. If any part of the plan cannot be trusted — a link has moved since
     * the index last read the file, a document will not open — no edit is contributed at all.
     * Half the links moving is worse than none moving, because nothing on screen says which half,
     * and the user is left diffing their own vault to find out.
     *
     * The rename always happens. Whatever goes wrong in here resolves to an empty edit; the
     * participant never rejects and never throws, because a failure to rewrite links is not a
     * reason to refuse the file operation the user asked for.
     */
    vscode.workspace.onWillRenameFiles((event) => {
      event.waitUntil(renameEditFor(snapshot(), event.files));
    }),
    vscode.workspace.onDidRenameFiles((event) => {
      const rebuild = onceRebuild(onRebuild);
      for (const { oldUri, newUri } of event.files) {
        const wasNote = isMarkdownPath(oldUri);
        const isNote = isMarkdownPath(newUri);
        if (wasNote) applyChange("remove", oldUri);
        if (isNote) applyChange("upsert", newUri);
        if (!wasNote && !isNote) rebuild();
      }
    }),
    vscode.workspace.onDidCreateFiles((event) => {
      const rebuild = onceRebuild(onRebuild);
      for (const uri of event.files) {
        if (isMarkdownPath(uri)) applyChange("upsert", uri);
        else rebuild();
      }
    }),
    vscode.workspace.onDidDeleteFiles((event) => {
      const rebuild = onceRebuild(onRebuild);
      for (const uri of event.files) {
        if (isMarkdownPath(uri)) applyChange("remove", uri);
        else rebuild();
      }
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("vispNotes.exclude")) {
        onRebuild();
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(onRebuild),
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (isIndexableMarkdown(event.document.uri)) {
        scheduleTextChange(event.document.uri);
      }
    }),
    vscode.workspace.onDidCloseTextDocument((document) => {
      if (isIndexableMarkdown(document.uri)) {
        clearPendingChange(document.uri);
        onChange({ kind: "upsert", uri: document.uri });
      }
    }),
    new vscode.Disposable(() => {
      for (const pending of pendingTextChanges.values()) {
        clearTimeout(pending);
      }
      pendingTextChanges.clear();
    }),
  ];
}

async function renameEditFor(
  snapshot: IndexSnapshot,
  files: readonly FileRename[],
): Promise<vscode.WorkspaceEdit> {
  try {
    return (await planFileRenameEdit(snapshot, files)) ?? new vscode.WorkspaceEdit();
  } catch {
    /*
     * Said out loud, because silence about broken links is the bug this whole handler exists to
     * fix — but as a notification, never a modal: the rename is mid-flight behind it.
     */
    void vscode.window.showWarningMessage(
      "Visp Notes did not update the links to the note you renamed: the index is behind what is " +
      "on disk. Undo the rename, run Rebuild Index, and rename again.",
    );
    return new vscode.WorkspaceEdit();
  }
}

/*
 * A folder that moved is why any of these rebuild at all. `createFileSystemWatcher` globs file
 * paths, so the Markdown glob above can never match a folder, and a folder dragged elsewhere or
 * deleted used to leave every note inside it in the panel, in the graph, and answering links,
 * until somebody happened to find Rebuild Index. A URI that is not a Markdown file is, for this
 * extension's purposes, a folder, and reading the workspace again is the only honest answer.
 *
 * Once per event, though. Dragging forty folders at once is one gesture and deserves one rebuild,
 * not forty full re-reads of the vault queued behind each other.
 */
function onceRebuild(onRebuild: () => void): () => void {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    onRebuild();
  };
}

function isMarkdownPath(uri: vscode.Uri): boolean {
  return uri.path.toLocaleLowerCase().endsWith(".md");
}
