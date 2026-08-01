import * as vscode from "vscode";
import { DraftRecoveryStore } from "./application/draftRecoveryStore";
import { WorkspaceIndex } from "./indexing/workspaceIndex";
import { WikiLinkDiagnostics } from "./vscode/diagnostics";
import { registerCommands } from "./vscode/commands/registerCommands";
import { openNote } from "./vscode/commands/openNote";
import { toggleTask } from "./vscode/commands/taskCommands";
import { GraphPanel } from "./vscode/providers/graphPanel";
import { IndexStatusItem } from "./vscode/providers/indexStatusItem";
import { NoteEditorProvider } from "./vscode/providers/noteEditorProvider";
import { WorkspacePanel } from "./vscode/providers/workspacePanel";
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
  const workspacePanel = new WorkspacePanel(context.extensionUri, index, {
    openNote: (uri) => openNote(vscode.Uri.parse(uri), true),
    openTasks: (filter) => tasks.show(filter),
    openGraph: (focusUri) => graph.show(focusUri),
    revealTask: (noteUri, start) => revealOffset(vscode.Uri.parse(noteUri), start),
    toggleTask: (noteUri, start, taskId, completed, version) =>
      toggleTask(index, noteUri, start, taskId, completed, version),
  });
  const diffPreview = new TextDiffPreviewProvider();
  const noteEditor = new NoteEditorProvider(
    context.extensionUri,
    index,
    (uri) => workspacePanel.setActiveNote(uri),
    (title, before, after) => diffPreview.show(title, before, after),
    draftRecoveries,
  );
  activeNoteEditor = noteEditor;
  const diagnostics = new WikiLinkDiagnostics(index);
  const indexStatus = new IndexStatusItem(index);

  context.subscriptions.push(
    output,
    index,
    tasks,
    graph,
    noteEditor,
    workspacePanel,
    diagnostics,
    indexStatus,
    diffPreview,
    diffPreview.register(),
    noteEditor.register(),
    vscode.window.registerWebviewViewProvider("vispNotes.workspace", workspacePanel, {
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
      tasks.update();
      graph.update();
      noteEditor.updateIndexState();
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor?.document.languageId === "markdown") {
        workspacePanel.setActiveNote(editor.document.uri.toString());
      }
    }),
  );

  registerCommands(
    context,
    index,
    {
      openTasks: (filter) => tasks.show(filter),
      openGraph: (focusUri) => graph.show(focusUri),
      showBacklinks: (uri) => noteEditor.revealInspector(uri),
      toggleEditor: (uri) => noteEditor.toggle(uri),
      activeNoteUri: () => noteEditor.activeUri,
      insertLink: (target) => noteEditor.insertLink(target),
      insertTag: (tag) => noteEditor.applyTag(tag, "add"),
      removeTag: (tag) => noteEditor.applyTag(tag, "remove"),
      showDiffPreview: (title, before, after) => diffPreview.show(title, before, after),
    },
    output,
  );

  const activeDocument = vscode.window.activeTextEditor?.document;
  if (activeDocument?.languageId === "markdown") {
    workspacePanel.setActiveNote(activeDocument.uri.toString());
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
