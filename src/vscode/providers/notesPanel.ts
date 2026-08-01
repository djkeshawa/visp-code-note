import * as vscode from "vscode";
import type { HostToNotesMessage, NoteListMode } from "../../domain/protocol";
import type { IndexSnapshot } from "../../domain/models";
import { buildNoteListing, listingTitle } from "../../application/noteListing";
import { createNotesHtml } from "../../ui";
import { isNotesMessage } from "./messageValidation";

/**
 * Orphan notes and broken links, in the window.
 *
 * Both were quick picks. A dropdown over the command palette is the right shape for choosing
 * one of a handful of things and the wrong shape for working through a list: it is a dozen
 * rows tall, it cannot be read beside anything, and it disappears the moment focus moves. One
 * panel serves both because they are the same shape — a note, a quiet detail, a way in.
 */
export class NotesPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private panelSubscriptions: vscode.Disposable[] = [];
  private mode: NoteListMode = "orphans";

  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly getSnapshot: () => IndexSnapshot,
    private readonly onOpen: (uri: string, start?: number) => Promise<void>,
  ) {}

  public show(mode: NoteListMode): void {
    this.mode = mode;
    if (this.panel) {
      this.panel.title = this.title;
      this.panel.reveal(vscode.ViewColumn.Active, false);
      void this.publish();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "vispNotes.notes",
      this.title,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
      },
    );
    this.panel = panel;
    panel.iconPath = vscode.Uri.joinPath(this.extensionUri, "media", "activity.svg");
    panel.webview.html = createNotesHtml({ webview: panel.webview, extensionUri: this.extensionUri });
    this.panelSubscriptions = [
      panel.webview.onDidReceiveMessage((message: unknown) => this.handleMessage(message)),
      panel.onDidDispose(() => this.clearPanel(panel)),
    ];
  }

  public update(): void {
    void this.publish();
  }

  public dispose(): void {
    this.panel?.dispose();
    this.clearPanel(this.panel);
  }

  /** The state the panel would render right now. Used by the tests. */
  public stateForTests(mode: NoteListMode) {
    return { mode, rows: buildNoteListing(this.getSnapshot(), mode) };
  }

  private get title(): string {
    return `Visp Notes: ${listingTitle(this.mode)}`;
  }

  private handleMessage(value: unknown): void {
    if (!isNotesMessage(value)) return;
    if (value.type === "notes/ready") {
      void this.publish();
      return;
    }
    // Checked against the index first, as every other URI-bearing handler is.
    const snapshot = this.getSnapshot();
    if (!snapshot.notes.some((note) => note.uri === value.uri)) return;
    void this.onOpen(value.uri, value.start).catch((error: unknown) => {
      void this.panel?.webview.postMessage({
        type: "notes/error",
        message: error instanceof Error ? error.message : String(error),
      } satisfies HostToNotesMessage);
    });
  }

  private async publish(): Promise<void> {
    const panel = this.panel;
    if (panel === undefined) return;
    const snapshot = this.getSnapshot();
    await panel.webview.postMessage({
      type: "notes/state",
      state: {
        mode: this.mode,
        rows: buildNoteListing(snapshot, this.mode),
        indexedAt: snapshot.indexedAt,
      },
    } satisfies HostToNotesMessage);
  }

  private clearPanel(panel: vscode.WebviewPanel | undefined): void {
    if (panel !== undefined && panel !== this.panel) return;
    for (const subscription of this.panelSubscriptions.splice(0)) subscription.dispose();
    this.panel = undefined;
  }
}
