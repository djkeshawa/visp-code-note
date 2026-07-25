import * as vscode from "vscode";
import { DraftRecoveryStore } from "./application/draftRecoveryStore";
import { WorkspaceIndex } from "./indexing/workspaceIndex";
import { WikiLinkDiagnostics } from "./vscode/diagnostics";
import { registerCommands } from "./vscode/commands/registerCommands";
import { openNote } from "./vscode/commands/openNote";
import { toggleTask } from "./vscode/commands/taskCommands";
import { BacklinksProvider } from "./vscode/providers/backlinksProvider";
import { GraphPanel } from "./vscode/providers/graphPanel";
import { NoteEditorProvider } from "./vscode/providers/noteEditorProvider";
import { NotesExplorerProvider } from "./vscode/providers/explorerProvider";
import { TasksPanel } from "./vscode/providers/tasksPanel";
import { WikiCompletionProvider } from "./vscode/providers/wikiCompletionProvider";
import { WikiLinkProvider } from "./vscode/providers/wikiLinkProvider";
import { WikiLinkCodeActionProvider } from "./vscode/providers/wikiLinkCodeActionProvider";
import { TextDiffPreviewProvider } from "./vscode/providers/textDiffPreviewProvider";
import { revealOffset } from "./vscode/documentEdits";

const MARKDOWN_FILE_SELECTOR: vscode.DocumentSelector = { scheme: "file", language: "markdown" };
let draftRecoveryStore: DraftRecoveryStore | undefined;
let activeNoteEditor: NoteEditorProvider | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel("Visp Notes", { log: true });
  const draftRecoveries = new DraftRecoveryStore(
    context.workspaceState,
    (error) => output.error(`Draft recovery persistence failed: ${String(error)}`),
  );
  draftRecoveryStore = draftRecoveries;
  const index = new WorkspaceIndex();
  const backlinks = new BacklinksProvider(context.extensionUri, () => index.snapshot);
  const tasks = new TasksPanel(
    context.extensionUri,
    () => index.snapshot,
    (noteUri, start, taskId, completed, version) =>
      toggleTask(index, noteUri, start, taskId, completed, version),
    (noteUri, start) => revealOffset(vscode.Uri.parse(noteUri), start),
  );
  const graph = new GraphPanel(
    context.extensionUri,
    () => index.snapshot,
    (uri) => openNote(vscode.Uri.parse(uri), true),
  );
  const noteEditor = new NoteEditorProvider(
    context.extensionUri,
    index,
    (uri) => backlinks.setActiveUri(uri),
    draftRecoveries,
  );
  activeNoteEditor = noteEditor;
  const explorer = new NotesExplorerProvider(index);
  const diagnostics = new WikiLinkDiagnostics(index);
  const diffPreview = new TextDiffPreviewProvider();

  context.subscriptions.push(
    output,
    index,
    backlinks,
    tasks,
    graph,
    noteEditor,
    explorer,
    diagnostics,
    diffPreview,
    diffPreview.register(),
    noteEditor.register(),
    vscode.window.createTreeView("vispNotes.explorer", {
      treeDataProvider: explorer,
      showCollapseAll: true,
    }),
    vscode.window.registerWebviewViewProvider("vispNotes.backlinks", backlinks, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.languages.registerDocumentLinkProvider(
      MARKDOWN_FILE_SELECTOR,
      new WikiLinkProvider(index),
    ),
    vscode.languages.registerCompletionItemProvider(
      MARKDOWN_FILE_SELECTOR,
      new WikiCompletionProvider(index),
      "[",
      "#",
      "^",
    ),
    vscode.languages.registerCodeActionsProvider(
      MARKDOWN_FILE_SELECTOR,
      new WikiLinkCodeActionProvider(),
      WikiLinkCodeActionProvider.metadata,
    ),
    index.onDidChange(() => {
      backlinks.update();
      tasks.update();
      graph.update();
      noteEditor.updateIndexState();
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor?.document.languageId === "markdown") {
        backlinks.setActiveUri(editor.document.uri.toString());
      }
    }),
  );

  registerCommands(
    context,
    index,
    {
      openTasks: (filter) => tasks.show(filter),
      openGraph: (focusUri) => graph.show(focusUri),
      showBacklinks: (uri) => backlinks.reveal(uri),
      toggleEditor: (uri) => noteEditor.toggle(uri),
      activeNoteUri: () => noteEditor.activeUri,
      insertLink: (target) => noteEditor.insertLink(target),
      showDiffPreview: (title, before, after) => diffPreview.show(title, before, after),
    },
    output,
  );

  const activeDocument = vscode.window.activeTextEditor?.document;
  if (activeDocument?.languageId === "markdown") {
    backlinks.setActiveUri(activeDocument.uri.toString());
  }

  try {
    await index.initialize();
    output.info(`Indexed ${index.snapshot.notes.length} Markdown notes.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    output.error(`Initial index failed: ${message}`);
    void vscode.window.showWarningMessage(
      "Visp Notes could not build its initial index. Use “Rebuild Index” after checking the log.",
      "Show Log",
    ).then((choice) => {
      if (choice === "Show Log") {
        output.show(true);
      }
    });
  }
}

export async function deactivate(): Promise<void> {
  activeNoteEditor?.dispose();
  activeNoteEditor = undefined;
  await draftRecoveryStore?.flush();
  draftRecoveryStore = undefined;
}
