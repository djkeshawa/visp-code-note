import * as vscode from "vscode";
import { getBrokenLinks } from "../../indexing/projections";
import { wikiTargetForNote } from "../../indexing/noteResolver";
import type { CommandIndex, FeatureViews } from "./contracts";
import { activeMarkdownUri, coerceUri, pickNote } from "./commandUtils";
import { openNote } from "./openNote";
import { revealOffset } from "../documentEdits";

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

export async function findBrokenLinks(index: CommandIndex): Promise<void> {
  const broken = getBrokenLinks(index.snapshot);
  if (broken.length === 0) {
    void vscode.window.showInformationMessage("Visp Notes found no broken wiki links.");
    return;
  }

  const notesByUri = new Map(index.snapshot.notes.map((note) => [note.uri, note]));
  const picked = await vscode.window.showQuickPick(
    broken.map((item) => ({
      label: `$(warning) ${item.link.raw}`,
      description: notesByUri.get(item.sourceUri)?.path,
      detail: "Unresolved note, heading, or block reference",
      item,
    })),
    { placeHolder: `${broken.length} unresolved wiki link${broken.length === 1 ? "" : "s"}` },
  );
  if (picked) {
    await revealOffset(vscode.Uri.parse(picked.item.sourceUri), picked.item.link.range.start);
  }
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
