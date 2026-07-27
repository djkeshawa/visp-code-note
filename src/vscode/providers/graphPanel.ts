import * as vscode from "vscode";
import type { HostToGraphMessage } from "../../domain/protocol";
import type { IndexSnapshot } from "../../domain/models";
import { buildLocalGraph, buildWorkspaceGraph } from "../../indexing/projections";
import { createGraphHtml } from "../../ui";
import { isGraphMessage } from "./messageValidation";

export class GraphPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private focusUri: string | undefined;
  private depth: 1 | 2;
  private panelSubscriptions: vscode.Disposable[] = [];

  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly getSnapshot: () => IndexSnapshot,
    private readonly onOpen: (uri: string) => Promise<void>,
  ) {
    // The type argument is a compile-time claim about a value a workspace supplies, so the
    // value itself is checked: anything else falls back to the default rather than reaching
    // the graph projection.
    const configured: unknown = vscode.workspace.getConfiguration("vispNotes")
      .get("graph.defaultDepth", 1);
    this.depth = configured === 2 ? 2 : 1;
  }

  public show(focusUri?: string): void {
    this.focusUri = focusUri;
    if (this.panel) {
      this.panel.title = this.title;
      this.panel.reveal(vscode.ViewColumn.Active, false);
      void this.publish();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "vispNotes.graph",
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
    panel.webview.html = createGraphHtml({ webview: panel.webview, extensionUri: this.extensionUri });
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

  private async handleMessage(value: unknown): Promise<void> {
    if (!isGraphMessage(value)) {
      return;
    }
    const message = value;
    switch (message.type) {
      case "graph/ready":
        await this.publish();
        break;
      case "graph/depth":
        this.depth = message.depth;
        await this.publish();
        break;
      case "graph/open":
        if (this.getSnapshot().notes.some((note) => note.uri === message.uri)) {
          await this.onOpen(message.uri);
        }
        break;
    }
  }

  private async publish(): Promise<void> {
    if (!this.panel) {
      return;
    }
    const snapshot = this.getSnapshot();
    const graph = this.focusUri
      ? buildLocalGraph(snapshot, this.focusUri, this.depth)
      : buildWorkspaceGraph(snapshot);
    await this.panel.webview.postMessage({
      type: "graph/state",
      graph,
      depth: this.depth,
      local: this.focusUri !== undefined,
    } satisfies HostToGraphMessage);
  }

  private get title(): string {
    return this.focusUri ? "Visp Notes: Local Graph" : "Visp Notes: Knowledge Graph";
  }

  private clearPanel(panel: vscode.WebviewPanel | undefined): void {
    if (this.panel === panel) {
      this.panel = undefined;
    }
    const subscriptions = this.panelSubscriptions.splice(0);
    for (const disposable of subscriptions) disposable.dispose();
  }
}
