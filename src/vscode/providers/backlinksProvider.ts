import * as vscode from "vscode";
import type {
  BacklinksState,
  BacklinksToHostMessage,
  HostToBacklinksMessage,
} from "../../domain/protocol";
import type { IndexSnapshot } from "../../domain/models";
import { createBacklinksHtml } from "../../ui";
import { revealOffset } from "../documentEdits";
import { isBacklinksMessage } from "./messageValidation";

export class BacklinksProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private activeUri: string | undefined;
  private viewSubscriptions: vscode.Disposable[] = [];

  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly getSnapshot: () => IndexSnapshot,
  ) {}

  public resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
    };
    view.webview.html = createBacklinksHtml({ webview: view.webview, extensionUri: this.extensionUri });
    this.viewSubscriptions = [
      view.webview.onDidReceiveMessage((message: unknown) => this.handleMessage(message)),
      view.onDidDispose(() => this.clearView(view)),
    ];
  }

  public setActiveUri(uri: string | undefined): void {
    this.activeUri = uri;
    void this.publish();
  }

  public update(): void {
    void this.publish();
  }

  public async reveal(uri?: string): Promise<void> {
    if (uri) {
      this.setActiveUri(uri);
    }
    await vscode.commands.executeCommand("workbench.view.extension.vispNotes");
    await vscode.commands.executeCommand("vispNotes.backlinks.focus");
  }

  public dispose(): void {
    this.clearView(this.view);
  }

  private async handleMessage(value: unknown): Promise<void> {
    if (!isBacklinksMessage(value)) {
      return;
    }
    const message = value;
    switch (message.type) {
      case "backlinks/ready":
        await this.publish();
        break;
      case "backlinks/open":
        if (this.buildState().backlinks.some(
          (backlink) => backlink.sourceUri === message.uri && backlink.range.start === message.start,
        )) {
          await revealOffset(vscode.Uri.parse(message.uri), message.start);
        }
        break;
    }
  }

  private async publish(): Promise<void> {
    await this.view?.webview.postMessage({
      type: "backlinks/state",
      state: this.buildState(),
    } satisfies HostToBacklinksMessage);
  }

  private buildState(): BacklinksState {
    const snapshot = this.getSnapshot();
    const note = this.activeUri
      ? snapshot.notes.find((candidate) => candidate.uri === this.activeUri)
      : undefined;
    if (!note) {
      return { backlinks: [], outgoingCount: 0, taskCount: 0 };
    }
    return {
      noteUri: note.uri,
      noteTitle: note.title,
      backlinks: snapshot.backlinks.filter((backlink) => backlink.targetUri === note.uri),
      outgoingCount: snapshot.links.filter((link) => link.sourceUri === note.uri).length,
      taskCount: note.tasks.length,
    };
  }

  private clearView(view: vscode.WebviewView | undefined): void {
    if (this.view === view) {
      this.view = undefined;
    }
    const subscriptions = this.viewSubscriptions.splice(0);
    for (const disposable of subscriptions) disposable.dispose();
  }
}
