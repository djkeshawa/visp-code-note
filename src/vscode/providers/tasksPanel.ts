import * as vscode from "vscode";
import type { HostToTasksMessage, TaskReminder } from "../../domain/protocol";
import type { IndexSnapshot } from "../../domain/models";
import { createTasksHtml } from "../../ui";
import { isTasksMessage } from "./messageValidation";

export class TasksPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private panelSubscriptions: vscode.Disposable[] = [];
  private filter: "all" | "today" = "all";

  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly getSnapshot: () => IndexSnapshot,
    private readonly onToggle: (
      noteUri: string,
      start: number,
      taskId: string | undefined,
      completed: boolean,
      version: number,
    ) => Promise<void>,
    private readonly onOpen: (noteUri: string, start: number) => Promise<void>,
    private readonly getReminders: () => readonly TaskReminder[] = () => [],
  ) {}

  public show(filter: "all" | "today" = "all"): void {
    this.filter = filter;
    if (this.panel) {
      this.panel.title = this.title;
      this.panel.reveal(vscode.ViewColumn.Active, false);
      void this.publish();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "vispNotes.tasks",
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
    panel.webview.html = createTasksHtml({ webview: panel.webview, extensionUri: this.extensionUri });
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
    if (!isTasksMessage(value)) {
      return;
    }
    const message = value;
    try {
      switch (message.type) {
        case "tasks/ready":
          await this.publish();
          break;
        case "tasks/toggle":
          try {
            await this.onToggle(
              message.noteUri,
              message.start,
              message.taskId,
              message.completed,
              message.version,
            );
          } finally {
            await this.publish();
          }
          break;
        case "tasks/open":
          if (this.getSnapshot().tasks.some(
            (task) => task.noteUri === message.noteUri && task.range.start === message.start,
          )) {
            await this.onOpen(message.noteUri, message.start);
          }
          break;
      }
    } catch (error) {
      await this.panel?.webview.postMessage({
        type: "tasks/error",
        message: error instanceof Error ? error.message : String(error),
      } satisfies HostToTasksMessage);
    }
  }

  private async publish(): Promise<void> {
    await this.panel?.webview.postMessage({
      type: "tasks/state",
      snapshot: {
        tasks: this.getSnapshot().tasks,
        reminders: this.getReminders(),
        version: this.getSnapshot().version,
        indexedAt: this.getSnapshot().indexedAt,
        filter: this.filter,
      },
    } satisfies HostToTasksMessage);
  }

  private get title(): string {
    return this.filter === "today" ? "Visp Notes: Due Today" : "Visp Notes: Tasks";
  }

  private clearPanel(panel: vscode.WebviewPanel | undefined): void {
    if (this.panel === panel) {
      this.panel = undefined;
    }
    const subscriptions = this.panelSubscriptions.splice(0);
    for (const disposable of subscriptions) disposable.dispose();
  }
}
