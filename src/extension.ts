import * as vscode from "vscode";
import { DraftRecoveryStore } from "./application/draftRecoveryStore";
import { ReminderStore } from "./application/reminderStore";
import { PersonalDictionaryStore } from "./application/personalDictionaryStore";
import { upcomingReminders } from "./application/reminderSchedule";
import { WorkspaceIndex } from "./indexing/workspaceIndex";
import { WikiLinkDiagnostics } from "./vscode/diagnostics";
import { registerCommands } from "./vscode/commands/registerCommands";
import { openNote } from "./vscode/commands/openNote";
import { toggleTask } from "./vscode/commands/taskCommands";
import { GraphPanel } from "./vscode/providers/graphPanel";
import { IndexStatusItem } from "./vscode/providers/indexStatusItem";
import { NoteEditorProvider } from "./vscode/providers/noteEditorProvider";
import { NotesPanel } from "./vscode/providers/notesPanel";
import { ReminderScheduler, readReminderSettings } from "./vscode/providers/reminderScheduler";
import { WorkspacePanel } from "./vscode/providers/workspacePanel";
import { TasksPanel } from "./vscode/providers/tasksPanel";
import { WikiCompletionProvider } from "./vscode/providers/wikiCompletionProvider";
import { WikiLinkProvider } from "./vscode/providers/wikiLinkProvider";
import { WikiLinkCodeActionProvider } from "./vscode/providers/wikiLinkCodeActionProvider";
import { TextDiffPreviewProvider } from "./vscode/providers/textDiffPreviewProvider";
const MARKDOWN_FILE_SELECTOR: vscode.DocumentSelector = { scheme: "file", language: "markdown" };
let draftRecoveryStore: DraftRecoveryStore | undefined;
let reminderStore: ReminderStore | undefined;
let personalDictionary: PersonalDictionaryStore | undefined;
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
    (noteUri, start) => revealTask(noteUri, start),
    () => upcomingReminders(index.snapshot, readReminderSettings(), Date.now())
      .map(({ noteUri, noteTitle, start, text, due, at, dueAt }) => ({
        noteUri,
        noteTitle,
        start,
        text,
        ...(due === undefined ? {} : { due }),
        at,
        dueAt,
      })),
  );
  const graph = new GraphPanel(
    context.extensionUri,
    () => index.snapshot,
    (uri) => openNote(vscode.Uri.parse(uri), true),
  );
  const reminders = new ReminderScheduler(
    index,
    reminderStore = new ReminderStore(
      context.workspaceState,
      (error) => output.error(`Reminder persistence failed: ${String(error)}`),
    ),
    {
      revealTask: (noteUri, start) => revealTask(noteUri, start),
      toggleTask: (noteUri, start, taskId, completed, version) =>
        toggleTask(index, noteUri, start, taskId, completed, version),
      openTasks: (filter) => tasks.show(filter),
    },
    output,
  );
  const notesList = new NotesPanel(
    context.extensionUri,
    () => index.snapshot,
    (uri, start) => start === undefined
      ? openNote(vscode.Uri.parse(uri), true)
      : noteEditor.revealAt(uri, start),
  );
  const workspacePanel = new WorkspacePanel(context.extensionUri, index, {
    openNote: (uri) => openNote(vscode.Uri.parse(uri), true),
    openTasks: (filter) => tasks.show(filter),
    openGraph: (focusUri) => graph.show(focusUri),
    openNotesList: (listing) => notesList.show(listing),
    revealTask: (noteUri, start) => revealTask(noteUri, start),
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
    output,
    /*
     * Global rather than workspace state: a word you have vouched for is a fact about your own
     * vocabulary, not about a repository, and re-accepting your own surname in every workspace
     * would be tedious enough that nobody would use the feature.
     */
    personalDictionary = new PersonalDictionaryStore(
      context.globalState,
      (error) => output.error(`Personal dictionary persistence failed: ${String(error)}`),
    ),
  );
  activeNoteEditor = noteEditor;
  const diagnostics = new WikiLinkDiagnostics(index);
  const indexStatus = new IndexStatusItem(index);

  context.subscriptions.push(
    output,
    index,
    tasks,
    graph,
    notesList,
    reminders,
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
      notesList.update();
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
      openNotesList: (listing) => notesList.show(listing),
      showBacklinks: (uri) => noteEditor.revealInspector(uri),
      toggleEditor: (uri) => noteEditor.toggle(uri),
      activeNoteUri: () => noteEditor.activeUri,
      insertLink: (target) => noteEditor.insertLink(target),
      formatInline: (mark) => noteEditor.applyInlineFormat(mark),
      insertTag: (tag) => noteEditor.applyTag(tag, "add"),
      removeTag: (tag) => noteEditor.applyTag(tag, "remove"),
      showDiffPreview: (title, before, after) => diffPreview.show(title, before, after),
    },
    output,
  );

  /*
   * The panels are built before the editor provider they reveal through, so the call is late
   * bound. Every one of them shows the note in the Visp Notes editor rather than the raw file.
   */
  function revealTask(noteUri: string, start: number): Promise<void> {
    return noteEditor.revealAt(noteUri, start);
  }

  const activeDocument = vscode.window.activeTextEditor?.document;
  if (activeDocument?.languageId === "markdown") {
    workspacePanel.setActiveNote(activeDocument.uri.toString());
  }

  try {
    await index.initialize();
    output.info(`Indexed ${index.snapshot.notes.length} Markdown notes.`);
    // After the first index, so the catch-up pass sees the workspace's tasks rather than none.
    reminders.start();
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
  // Both stores, for the same reason: a write still in flight when the window goes would
  // otherwise show a reminder again that has already been answered.
  await Promise.all([
    draftRecoveryStore?.flush(),
    reminderStore?.flush(),
    personalDictionary?.flush(),
  ]);
  draftRecoveryStore = undefined;
  reminderStore = undefined;
  personalDictionary = undefined;
}
