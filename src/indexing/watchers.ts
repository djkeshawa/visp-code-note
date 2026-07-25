import * as vscode from "vscode";
import { isIndexableMarkdown } from "./discovery";

export type MarkdownChange =
  | { readonly kind: "upsert"; readonly uri: vscode.Uri }
  | { readonly kind: "remove"; readonly uri: vscode.Uri };

export function createIndexWatchers(
  onChange: (change: MarkdownChange) => void,
  onRebuild: () => void,
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
