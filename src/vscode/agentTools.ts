import * as vscode from "vscode";
import type { IndexSnapshot, NoteRecord } from "../domain/models";
import { AGENT_TOOLS, answerAgentTool } from "../application/agentTools";
import type { AgentToolContext } from "../application/agentTools";
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

/**
 * Read-only tools that let Copilot's agent mode — and any other chat participant that uses
 * `vscode.lm` tools — work with notes the way the graph does. What they answer is shared with
 * the MCP server (see `application/agentTools.ts`); this only supplies what an editor knows
 * that a file reader does not: which note is open, and the unsaved text of open notes.
 */
export function registerAgentTools(
  snapshot: () => IndexSnapshot,
  lastNoteEditorUri: () => vscode.Uri | undefined,
): vscode.Disposable[] {
  const openText = (note: NoteRecord): string | undefined =>
    vscode.workspace.textDocuments.find((document) => document.uri.toString() === note.uri)?.getText();
  const context = (): AgentToolContext => {
    const current = snapshot();
    const uri = activeNoteUri(lastNoteEditorUri)?.toString();
    const note = uri === undefined ? undefined : current.notes.find((entry) => entry.uri === uri);
    return {
      snapshot: current,
      today: todayStamp(),
      openText,
      ...(note === undefined ? {} : { active: { note, content: openText(note) ?? note.content } }),
    };
  };
  return AGENT_TOOLS.map((tool) => vscode.lm.registerTool<unknown>(`visp_${tool.name}`, {
    prepareInvocation: () => ({ invocationMessage: `Visp Notes: ${tool.title.toLowerCase()}` }),
    invoke: (options) => new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(answerAgentTool(tool.name, options.input, context())),
    ]),
  }));
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
