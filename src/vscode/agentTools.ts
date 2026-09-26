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
 *
 * The tools exist only while two things hold. The workspace is trusted — an untrusted
 * repository's notes are exactly where instructions aimed at an agent would be planted — and
 * `vispNotes.agents.enabled` is on, so a company or a reader can switch agent access off
 * without uninstalling anything. Both are followed live: granting trust or flipping the setting
 * registers or withdraws the tools at once, and a chat already open sees the change.
 */
export class AgentToolRegistration implements vscode.Disposable {
  private tools: vscode.Disposable[] = [];
  private readonly listeners: vscode.Disposable[];

  public constructor(
    private readonly snapshot: () => IndexSnapshot,
    private readonly lastNoteEditorUri: () => vscode.Uri | undefined,
  ) {
    this.listeners = [
      vscode.workspace.onDidGrantWorkspaceTrust(() => this.sync()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("vispNotes.agents.enabled")) this.sync();
      }),
    ];
    this.sync();
  }

  public get registered(): boolean {
    return this.tools.length > 0;
  }

  public dispose(): void {
    this.withdraw();
    for (const listener of this.listeners) listener.dispose();
  }

  private sync(): void {
    const wanted = vscode.workspace.isTrusted && agentAccessEnabled();
    if (wanted && this.tools.length === 0) this.tools = this.register();
    else if (!wanted) this.withdraw();
  }

  private withdraw(): void {
    for (const tool of this.tools) tool.dispose();
    this.tools = [];
  }

  private register(): vscode.Disposable[] {
    const openText = (note: NoteRecord): string | undefined =>
      vscode.workspace.textDocuments.find((document) => document.uri.toString() === note.uri)?.getText();
    const context = (): AgentToolContext => {
      const current = this.snapshot();
      const uri = activeNoteUri(this.lastNoteEditorUri)?.toString();
      const note = uri === undefined ? undefined : current.notes.find((entry) => entry.uri === uri);
      return {
        snapshot: current,
        today: todayStamp(),
        openText,
        exclude: agentExcludes(),
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
}

export function agentAccessEnabled(): boolean {
  return vscode.workspace.getConfiguration("vispNotes").get<boolean>("agents.enabled", true);
}

function agentExcludes(): readonly string[] {
  const value = vscode.workspace.getConfiguration("vispNotes").get<unknown>("agents.exclude", []);
  return Array.isArray(value)
    ? value.filter((pattern): pattern is string => typeof pattern === "string" && pattern.trim() !== "").map((pattern) => pattern.trim())
    : [];
}

interface ChatTarget {
  readonly label: string;
  readonly detail: string;
  /** The command that proves the agent is installed, and opens it. */
  readonly command: string;
  readonly open: (uri: vscode.Uri) => Thenable<unknown>;
}

/**
 * Where "Ask Chat About This Note" can send a note, in the order offered.
 *
 * Each agent is recognised by a command it registers, and only agents that are installed are
 * offered. Claude Code and Codex take the note in the way their own "add file" features do —
 * an @-mention in a new Claude conversation, a file added to the Codex thread — because
 * neither can see a note open in the Visp Notes editor as the current file. Their commands are
 * not a published API, so a change on their side means the choice fails with a message rather
 * than silently doing nothing.
 */
const CHAT_TARGETS: readonly ChatTarget[] = [
  {
    label: "Copilot Chat",
    detail: "VS Code chat, with the note attached",
    command: "workbench.action.chat.open",
    open: (uri) => vscode.commands.executeCommand("workbench.action.chat.open", { attachFiles: [uri] }),
  },
  {
    label: "Claude Code",
    detail: "A new Claude conversation that mentions the note",
    command: "claude-vscode.editor.open",
    open: (uri) => vscode.commands.executeCommand(
      "claude-vscode.editor.open",
      undefined,
      `@${vscode.workspace.asRelativePath(uri, false)} `,
    ),
  },
  {
    label: "Codex",
    detail: "Adds the note to the Codex thread",
    command: "chatgpt.addFileToThread",
    open: async (uri) => {
      await vscode.commands.executeCommand("chatgpt.openSidebar");
      await vscode.commands.executeCommand("chatgpt.addFileToThread", uri);
    },
  },
];

const LAST_CHAT_TARGET = "vispNotes.lastChatTarget";

/**
 * Opens an agent's chat with the note in it, which is what that agent would have done on its
 * own for a note open in the text editor. With one agent installed it goes straight there;
 * with several the reader picks, and the last pick is offered first next time.
 */
export async function askChatAboutNote(uri: vscode.Uri | undefined, memory?: vscode.Memento): Promise<void> {
  if (uri === undefined) {
    void vscode.window.showInformationMessage("Open a note first, then ask chat about it.");
    return;
  }
  const commands = new Set(await vscode.commands.getCommands(true));
  const available = CHAT_TARGETS.filter((target) => commands.has(target.command));
  if (available.length === 0) {
    void vscode.window.showInformationMessage(
      "No chat is available in this window. Install GitHub Copilot Chat, Claude Code or Codex to ask about notes.",
    );
    return;
  }
  const last = memory?.get<string>(LAST_CHAT_TARGET);
  const ordered = [...available].sort((left, right) => Number(right.label === last) - Number(left.label === last));
  const target = ordered.length === 1
    ? ordered[0]
    : await vscode.window.showQuickPick(ordered.map((entry) => ({ ...entry, description: entry.detail })), {
      title: "Ask about this note in…",
      placeHolder: "Which agent?",
    });
  if (target === undefined) return;
  await memory?.update(LAST_CHAT_TARGET, target.label);
  try {
    await target.open(uri);
  } catch (error) {
    void vscode.window.showWarningMessage(`${target.label} could not be opened with the note: ${String(error)}`);
  }
}
