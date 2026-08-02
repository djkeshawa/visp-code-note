import * as vscode from "vscode";
import { wikiTargetForNote } from "../../indexing/noteResolver";
import type { CommandIndex, FeatureViews } from "./contracts";
import { activeMarkdownUri, coerceUri, pickNote } from "./commandUtils";
import { openNote } from "./openNote";

export async function insertWikiLink(index: CommandIndex, views: FeatureViews): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if ((!editor || editor.document.languageId !== "markdown") && !views.activeNoteUri()) {
    void vscode.window.showInformationMessage("Open a Markdown document before inserting a note link.");
    return;
  }

  const selected = await pickNote(index.snapshot.notes, "Link to a note");
  if (!selected) {
    return;
  }

  const sourceUri = editor?.document.languageId === "markdown"
    ? editor.document.uri.toString()
    : views.activeNoteUri()?.toString();
  const target = wikiTargetForNote(index.snapshot.notes, sourceUri, selected);
  if (!editor || editor.document.languageId !== "markdown") {
    if (!(await views.insertLink(target))) {
      void vscode.window.showInformationMessage("Focus a Visp note editor before inserting a link.");
    }
    return;
  }

  const selectedSource = editor.document.getText(editor.selection);
  const selectionText = selectedSource.trim();
  if (
    selectionText &&
    (selectedSource.includes("|") || selectedSource.includes("]") || /[\r\n]/.test(selectedSource))
  ) {
    void vscode.window.showWarningMessage(
      "The selected text cannot be used as a wiki-link alias because it contains |, ], or a line break.",
    );
    return;
  }
  const link = selectionText && selectionText !== selected.title
    ? `[[${target}|${selectedSource}]]`
    : `[[${target}]]`;
  if (!(await editor.edit((builder) => builder.replace(editor.selection, link)))) {
    throw new Error("VS Code rejected the wiki-link edit.");
  }
}

/**
 * Every wiki link that lands nowhere, in the window.
 *
 * This was a quick pick — a dropdown you could not read beside the note you were fixing, and
 * which closed the moment you looked away. The panel stays open while the links are repaired
 * and refreshes itself as each one starts resolving.
 */
export function findBrokenLinks(views: FeatureViews): void {
  views.openNotesList({ kind: "broken" });
}

export async function rebuildIndex(index: CommandIndex): Promise<void> {
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "Rebuilding Visp Notes index" },
    () => index.rebuild(),
  );
  void vscode.window.showInformationMessage(`Indexed ${index.snapshot.notes.length} Markdown notes.`);
}

export function showLocalGraph(views: FeatureViews, value?: unknown): void {
  const uri = coerceUri(value) ?? activeMarkdownUri() ?? views.activeNoteUri();
  if (!uri) {
    void vscode.window.showInformationMessage("Open a note before showing its local graph.");
    return;
  }
  views.openGraph(uri.toString());
}

export function showWorkspaceGraph(views: FeatureViews): void {
  views.openGraph();
}

export async function showBacklinks(views: FeatureViews, value?: unknown): Promise<void> {
  const uri = coerceUri(value) ?? activeMarkdownUri() ?? views.activeNoteUri();
  await views.showBacklinks(uri?.toString());
}

export async function toggleRenderedEditor(views: FeatureViews, value?: unknown): Promise<void> {
  await views.toggleEditor(coerceUri(value) ?? activeMarkdownUri());
}

export async function openNoteArgument(value: unknown): Promise<void> {
  await openNote(value, true);
}
