import * as vscode from "vscode";
import type { CommandIndex, FeatureViews } from "./contracts";
import { createNote } from "./createNote";
import {
  findBrokenLinks,
  insertWikiLink,
  openNoteArgument,
  rebuildIndex,
  showBacklinks,
  showLocalGraph,
  showWorkspaceGraph,
  toggleRenderedEditor,
} from "./navigationCommands";
import { renameNote } from "./renameNote";
import { searchWorkspace } from "./searchWorkspace";
import { createTask, toggleTaskAtEditor } from "./taskCommands";
import { createMissingNote } from "./createMissingNote";
import { useTextEditorByDefault, useVispNotesAsDefaultEditor } from "./editorAssociation";
import { addTagToNote, removeTagFromNote } from "./tagCommands";
import { COMMAND_IDS } from "../ids";

export function registerCommands(
  context: vscode.ExtensionContext,
  index: CommandIndex,
  views: FeatureViews,
  output: vscode.LogOutputChannel,
): void {
  const register = (id: string, callback: (...args: unknown[]) => Promise<void> | void): void => {
    context.subscriptions.push(
      vscode.commands.registerCommand(id, (...args: unknown[]) => {
        try {
          return Promise.resolve(callback(...args)).catch((error: unknown) => reportError(output, error));
        } catch (error) {
          reportError(output, error);
          return undefined;
        }
      }),
    );
  };

  register(COMMAND_IDS.newNote, () => createNote(index));
  register(COMMAND_IDS.createMissingNote, (source, target) =>
    createMissingNote(index, source, target));
  register(COMMAND_IDS.newTask, () => createTask(index, views.activeNoteUri()));
  register(COMMAND_IDS.toggleTask, () => toggleTaskAtEditor(index));
  register(COMMAND_IDS.insertLink, () => insertWikiLink(index, views));
  register(COMMAND_IDS.showBacklinks, (value) => showBacklinks(views, value));
  register(COMMAND_IDS.openLocalGraph, (value) => showLocalGraph(views, value));
  register(COMMAND_IDS.openWorkspaceGraph, () => showWorkspaceGraph(views));
  register(COMMAND_IDS.toggleRenderedSource, (value) => toggleRenderedEditor(views, value));
  register(COMMAND_IDS.renameNote, (value) => renameNote(
    index,
    value ?? views.activeNoteUri(),
    (title, before, after) => views.showDiffPreview(title, before, after),
  ));
  register(COMMAND_IDS.findBrokenLinks, () => findBrokenLinks(index));
  register(COMMAND_IDS.rebuildIndex, () => rebuildIndex(index));
  register(COMMAND_IDS.openTasks, (filter) => views.openTasks(filter === "today" ? "today" : "all"));
  register(COMMAND_IDS.openTodayTasks, () => views.openTasks("today"));
  register(COMMAND_IDS.search, () => searchWorkspace(index));
  register(COMMAND_IDS.openNote, (value) => openNoteArgument(value));
  register(COMMAND_IDS.addTag, () => addTagToNote(index, views));
  register(COMMAND_IDS.removeTag, () => removeTagFromNote(index, views));
  register(COMMAND_IDS.useAsDefaultEditor, () => useVispNotesAsDefaultEditor());
  register(COMMAND_IDS.useTextEditorByDefault, () => useTextEditorByDefault());
}

function reportError(output: vscode.LogOutputChannel, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const detail = error instanceof Error && error.stack ? error.stack : message;
  output.error(detail);
  void vscode.window.showErrorMessage(`Visp Notes: ${message}`, "Show Log").then((choice) => {
    if (choice === "Show Log") {
      output.show(true);
    }
  });
}
