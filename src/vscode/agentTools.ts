import * as vscode from "vscode";
import type { IndexSnapshot, NoteRecord } from "../domain/models";
import {
  describeLinkPath,
  describeNeighbourhood,
  describeNote,
  describeSearch,
  describeTasks,
  resolveNoteReference,
  unknownNote,
} from "../application/agentContext";
import type { TaskQuery } from "../application/agentContext";
import { todayStamp } from "./providers/explorerModel";

const NOTE_EDITOR = "vispNotes.noteEditor";

/**
 * The note the reader is looking at, whichever editor shows it.
 *
 * Chat's own "current file" context comes from the active *text* editor, and a note open in the
 * Visp Notes editor is a custom editor, so Copilot saw no file at all. The tab strip is the one
 * place both kinds of editor agree on what is showing, so it is asked first; the note editor's
 * own memory of its last active panel covers the moment focus has moved into the chat view.
 */
export function activeNoteUri(lastNoteEditorUri: () => vscode.Uri | undefined): vscode.Uri | undefined {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  if (input instanceof vscode.TabInputCustom && input.viewType === NOTE_EDITOR) return input.uri;
  if (input instanceof vscode.TabInputText && input.uri.path.toLowerCase().endsWith(".md")) return input.uri;
  return lastNoteEditorUri();
}

interface NoteInput { readonly note: string }
interface OptionalNoteInput { readonly note?: string; readonly depth?: number }
interface SearchInput { readonly query: string; readonly limit?: number }
interface PathInput { readonly from: string; readonly to: string }
interface TasksInput extends Omit<TaskQuery, "note"> { readonly note?: string }

/**
 * Read-only tools that let Copilot's agent mode — and any other chat participant that uses
 * `vscode.lm` tools — work with notes the way the graph does: find a note, read it with its
 * links in both directions, walk its neighbourhood, trace how two notes connect, and list
 * tasks. None of them write; an agent edits a note with its ordinary file tools, using the
 * paths these answers give it.
 */
export function registerAgentTools(
  snapshot: () => IndexSnapshot,
  lastNoteEditorUri: () => vscode.Uri | undefined,
): vscode.Disposable[] {
  const active = (): { note: NoteRecord; content: string } | undefined => {
    const uri = activeNoteUri(lastNoteEditorUri);
    if (uri === undefined) return undefined;
    const note = snapshot().notes.find((entry) => entry.uri === uri.toString());
    if (note === undefined) return undefined;
    const open = vscode.workspace.textDocuments.find((document) => document.uri.toString() === note.uri);
    return { note, content: open?.getText() ?? note.content };
  };
  const find = (reference: string | undefined): NoteRecord | undefined =>
    reference === undefined || reference.trim() === ""
      ? active()?.note
      : resolveNoteReference(snapshot(), reference);

  return [
    tool<Record<string, never>>("visp_activeNote", () => "Reading the open note", () => {
      const current = active();
      return current === undefined
        ? "No note is open. Ask the user which note they mean, or use visp_searchNotes."
        : describeNote(snapshot(), current.note, current.content);
    }),
    tool<NoteInput>("visp_readNote", (input) => `Reading ${input.note}`, (input) => {
      const note = find(input.note);
      if (note === undefined) return unknownNote(input.note);
      const open = vscode.workspace.textDocuments.find((document) => document.uri.toString() === note.uri);
      return describeNote(snapshot(), note, open?.getText() ?? note.content);
    }),
    tool<SearchInput>("visp_searchNotes", (input) => `Searching notes for ${input.query}`, (input) =>
      describeSearch(snapshot(), input.query, input.limit)),
    tool<OptionalNoteInput>("visp_noteGraph", (input) => `Walking the graph around ${input.note ?? "the open note"}`, (input) => {
      const note = find(input.note);
      if (note === undefined) return input.note === undefined ? "No note is open." : unknownNote(input.note);
      return describeNeighbourhood(snapshot(), note, input.depth === 2 ? 2 : 1);
    }),
    tool<PathInput>("visp_linkPath", (input) => `Tracing links from ${input.from} to ${input.to}`, (input) => {
      const from = find(input.from);
      const to = find(input.to);
      if (from === undefined) return unknownNote(input.from);
      if (to === undefined) return unknownNote(input.to);
      return describeLinkPath(snapshot(), from, to);
    }),
    tool<TasksInput>("visp_listTasks", () => "Listing tasks", (input) => {
      const note = input.note === undefined ? undefined : find(input.note);
      if (input.note !== undefined && note === undefined) return unknownNote(input.note);
      const { note: _reference, ...filters } = input;
      return describeTasks(snapshot(), { ...filters, ...(note === undefined ? {} : { note }) }, todayStamp());
    }),
  ];
}

function tool<T>(
  name: string,
  describe: (input: T) => string,
  answer: (input: T) => string,
): vscode.Disposable {
  return vscode.lm.registerTool<T>(name, {
    prepareInvocation: (options) => ({ invocationMessage: describe(options.input) }),
    invoke: (options) => new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(answer(options.input)),
    ]),
  });
}

/**
 * Opens chat with the note attached as a file, which is what chat would have done on its own
 * for a note open in the text editor. Chat reads an attached file through VS Code's open
 * document, so unsaved edits go with it and nothing is saved behind the reader's back.
 */
export async function askChatAboutNote(uri: vscode.Uri | undefined): Promise<void> {
  if (uri === undefined) {
    void vscode.window.showInformationMessage("Open a note first, then ask chat about it.");
    return;
  }
  try {
    await vscode.commands.executeCommand("workbench.action.chat.open", { attachFiles: [uri] });
  } catch {
    void vscode.window.showInformationMessage(
      "Chat is not available in this window. Install GitHub Copilot Chat, or another chat extension, to ask about notes.",
    );
  }
}
