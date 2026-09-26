import * as vscode from "vscode";
import { ACTIVE_NOTE_DIRECTORY, activeNoteFileName } from "../application/activeNoteBridge";
import type { ActiveNoteEntry } from "../application/activeNoteBridge";
import { agentAccessEnabled, activeNoteUri } from "./agentTools";

/**
 * Tells agents outside the editor which note this window shows — see `activeNoteBridge.ts`.
 *
 * It writes only while agent access is on and the workspace is trusted, and only a note's path.
 * Each window writes when its own tabs change and again whenever it regains focus, so with
 * several windows open the one the reader was last in is the newest. It removes its file when
 * the window closes, when access is switched off, and when no note is showing. A note the reader hid with
 * `vispNotes.agents.exclude` is still named here, because the MCP server applies the exclusion
 * itself and refuses it — so the refusal is said, rather than the note silently looking closed.
 */
export class ActiveNotePublisher implements vscode.Disposable {
  private readonly file: vscode.Uri;
  private readonly disposables: vscode.Disposable[];
  private timer: NodeJS.Timeout | undefined;
  private written: string | undefined;
  /** Bumped each time the window gains focus, so returning to a window re-announces its note. */
  private focusCount = 0;

  public constructor(
    storage: vscode.Uri,
    private readonly lastNoteEditorUri: () => vscode.Uri | undefined,
  ) {
    this.file = vscode.Uri.joinPath(storage, ACTIVE_NOTE_DIRECTORY, activeNoteFileName(process.pid));
    const schedule = (): void => this.schedule();
    this.disposables = [
      vscode.window.tabGroups.onDidChangeTabs(schedule),
      vscode.window.tabGroups.onDidChangeTabGroups(schedule),
      vscode.window.onDidChangeWindowState((state) => {
        if (state.focused) this.focusCount += 1;
        schedule();
      }),
      vscode.workspace.onDidGrantWorkspaceTrust(schedule),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("vispNotes.agents.enabled")) schedule();
      }),
    ];
    this.schedule();
  }

  public dispose(): void {
    clearTimeout(this.timer);
    for (const disposable of this.disposables) disposable.dispose();
    void this.clear();
  }

  /** Coalesced, so switching tabs quickly writes once rather than once per tab. */
  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.publish().catch(() => undefined), 200);
  }

  private async publish(): Promise<void> {
    if (!vscode.workspace.isTrusted || !agentAccessEnabled()) {
      await this.clear();
      return;
    }
    /*
     * Claude Code opens as an editor tab of its own, and an agent may run in a terminal tab.
     * Moving into one of those is moving to *talk about* the note, not away from it, so the
     * last note stays announced.
     */
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    if (input instanceof vscode.TabInputWebview || input instanceof vscode.TabInputTerminal) return;
    const uri = activeNoteUri(this.lastNoteEditorUri);
    if (uri === undefined || uri.scheme !== "file") {
      await this.clear();
      return;
    }
    const key = `${this.focusCount}:${uri.fsPath}`;
    if (this.written === key) return;
    const entry: ActiveNoteEntry = { file: uri.fsPath, at: Date.now(), pid: process.pid };
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(this.file, ".."));
    await vscode.workspace.fs.writeFile(this.file, new TextEncoder().encode(JSON.stringify(entry)));
    this.written = key;
  }

  private async clear(): Promise<void> {
    if (this.written === undefined) return;
    this.written = undefined;
    await vscode.workspace.fs.delete(this.file).then(undefined, () => undefined);
  }
}
