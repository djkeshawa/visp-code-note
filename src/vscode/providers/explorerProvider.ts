import * as vscode from "vscode";
import type { WorkspaceIndex } from "../../indexing/workspaceIndex";
import { COMMAND_IDS } from "../ids";
import {
  type ExplorerNode,
  type ExplorerTask,
  ROOT_NODES,
  explorerRowId,
  fromBranch,
  noteChildren,
  notesWithTag,
  orphanNotes,
  smartViews,
  tagNodes,
  taskNodes,
} from "./explorerModel";
import { openRenderedNoteCommand, smartViewCommand } from "./explorerCommands";

export class NotesExplorerProvider
  implements vscode.TreeDataProvider<ExplorerNode>, vscode.Disposable
{
  private readonly changeEmitter = new vscode.EventEmitter<ExplorerNode | undefined>();
  private readonly subscriptions: vscode.Disposable[];

  readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor(
    private readonly index: WorkspaceIndex,
    private readonly toggleTask: (task: ExplorerTask, snapshotVersion: number) => Promise<void>,
  ) {
    this.subscriptions = [
      index.onDidChange(() => this.changeEmitter.fire(undefined)),
      index.onDidChangeStatus(() => this.changeEmitter.fire(undefined)),
    ];
  }

  getTreeItem(node: ExplorerNode): vscode.TreeItem {
    switch (node.kind) {
      case "section":
        return this.sectionItem(node.label, node.id === "tags");
      case "folder":
        return this.folderItem(node);
      case "note":
        return this.noteItem(node);
      case "smart":
        return this.smartItem(node);
      case "task":
        return this.taskItem(node);
      case "tag":
        return this.tagItem(node);
      case "status":
        return this.statusItem();
    }
  }

  getChildren(node?: ExplorerNode): ExplorerNode[] {
    if (!node) {
      return [...ROOT_NODES];
    }
    if (node.kind === "section") {
      if (node.id === "notes") {
        return fromBranch(noteChildren(this.index.snapshot), "notes");
      }
      return node.id === "smart"
        ? [...smartViews(this.index.snapshot)]
        : [...tagNodes(this.index.snapshot)];
    }
    if (node.kind === "folder") {
      return fromBranch(noteChildren(this.index.snapshot, node.path), "notes");
    }
    if (node.kind === "tag") {
      return fromBranch(notesWithTag(this.index.snapshot, node.tag), `tag:${node.tag}`);
    }
    if (node.kind === "smart") {
      if (node.id === "orphans") return fromBranch(orphanNotes(this.index.snapshot), "orphans");
      if (node.id === "tasks") return fromBranch(taskNodes(this.index.snapshot, "all"), "tasks");
      if (node.id === "due") return fromBranch(taskNodes(this.index.snapshot, "due"), "due");
    }
    return [];
  }

  /**
   * Checkbox changes arrive from the TreeView, so the owner wires this in. Completing a
   * task edits the checkbox in the Markdown file; the index refresh redraws the tree.
   */
  public async handleCheckboxChange(
    changes: readonly [ExplorerNode, vscode.TreeItemCheckboxState][],
  ): Promise<void> {
    for (const [node, state] of changes) {
      if (node.kind !== "task") continue;
      const requested = state === vscode.TreeItemCheckboxState.Checked;
      // The toggle is driven by the indexed state, so ignore events that ask for the
      // state the task is already in.
      if (requested === node.task.completed) continue;
      try {
        await this.toggleTask(node.task, node.snapshotVersion);
      } catch (error) {
        /*
         * The TreeView has already drawn the box in the state the user clicked, so a failed
         * toggle leaves the row disagreeing with the file. Redrawing from the index puts it
         * back. This used to reject out of a `void`-ed call, which surfaced as an unhandled
         * rejection in the extension host and told the user nothing.
         */
        this.changeEmitter.fire(undefined);
        void vscode.window.showErrorMessage(
          error instanceof Error ? error.message : String(error),
        );
        return;
      }
    }
  }

  dispose(): void {
    vscode.Disposable.from(...this.subscriptions).dispose();
    this.changeEmitter.dispose();
  }

  private sectionItem(label: string, collapsed: boolean): vscode.TreeItem {
    const item = new vscode.TreeItem(
      label,
      collapsed ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.Expanded,
    );
    item.contextValue = "vispNotes.section";
    return item;
  }

  private folderItem(node: Extract<ExplorerNode, { kind: "folder" }>): vscode.TreeItem {
    const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Collapsed);
    item.id = explorerRowId(node);
    item.contextValue = "vispNotes.folder";
    item.iconPath = vscode.ThemeIcon.Folder;
    return item;
  }

  private noteItem(node: Extract<ExplorerNode, { kind: "note" }>): vscode.TreeItem {
    const uri = vscode.Uri.parse(node.note.uri);
    const item = new vscode.TreeItem(node.note.title, vscode.TreeItemCollapsibleState.None);
    item.id = explorerRowId(node);
    item.contextValue = "vispNotes.note";
    item.description = node.note.fileName === `${node.note.title}.md` ? undefined : node.note.fileName;
    item.iconPath = new vscode.ThemeIcon("note");
    item.resourceUri = uri;
    item.tooltip = `${node.note.title}\n${node.note.path}`;
    item.command = openRenderedNoteCommand(uri);
    return item;
  }

  private taskItem(node: Extract<ExplorerNode, { kind: "task" }>): vscode.TreeItem {
    const { task } = node;
    const item = new vscode.TreeItem(
      task.text.length > 0 ? task.text : "Untitled task",
      vscode.TreeItemCollapsibleState.None,
    );
    item.id = explorerRowId(node);
    item.contextValue = "vispNotes.task";
    item.checkboxState = task.completed
      ? vscode.TreeItemCheckboxState.Checked
      : vscode.TreeItemCheckboxState.Unchecked;
    item.description = [task.due, task.noteTitle].filter(Boolean).join(" · ");
    item.tooltip = new vscode.MarkdownString(
      [
        task.text,
        "",
        `Note: ${task.noteTitle}`,
        ...(task.due === undefined ? [] : [`Due: ${task.due}`]),
        ...(task.priority === undefined ? [] : [`Priority: ${task.priority}`]),
        ...(task.tags.length === 0 ? [] : [`Tags: ${task.tags.map((tag) => `#${tag}`).join(" ")}`]),
      ].join("\n"),
    );
    item.command = {
      command: COMMAND_IDS.openNote,
      title: "Open Task",
      arguments: [task.noteUri],
    };
    return item;
  }

  private smartItem(node: Extract<ExplorerNode, { kind: "smart" }>): vscode.TreeItem {
    const expandable = (node.id === "orphans" || node.id === "tasks" || node.id === "due") &&
      (node.count ?? 0) > 0;
    const item = new vscode.TreeItem(
      node.label,
      expandable ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
    );
    item.id = explorerRowId(node);
    item.contextValue = `vispNotes.smart.${node.id}`;
    item.description = node.count === undefined ? undefined : String(node.count);
    item.iconPath = new vscode.ThemeIcon(SMART_ICONS[node.id]);
    item.command = smartViewCommand(node.id);
    return item;
  }

  private tagItem(node: Extract<ExplorerNode, { kind: "tag" }>): vscode.TreeItem {
    const item = new vscode.TreeItem(`#${node.tag}`, vscode.TreeItemCollapsibleState.Collapsed);
    item.id = explorerRowId(node);
    item.contextValue = "vispNotes.tag";
    item.description = String(node.count);
    item.iconPath = new vscode.ThemeIcon("tag");
    return item;
  }

  private statusItem(): vscode.TreeItem {
    const { notes, tasks, indexedAt } = this.index.snapshot;
    const label = this.index.status === "indexing"
      ? "Indexing Markdown…"
      : this.index.status === "error"
        ? "Index needs attention"
        : `${notes.length} note${notes.length === 1 ? "" : "s"} indexed`;
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.id = "status:index";
    item.contextValue = "vispNotes.indexStatus";
    item.description = `${tasks.length} task${tasks.length === 1 ? "" : "s"}`;
    item.iconPath = new vscode.ThemeIcon(this.index.status === "error" ? "error" : "database");
    item.tooltip = this.index.lastError
      ?? (indexedAt > 0 ? `Last indexed ${new Date(indexedAt).toLocaleString()}` : "Index not built yet");
    return item;
  }
}

const SMART_ICONS: Readonly<Record<Extract<ExplorerNode, { kind: "smart" }>["id"], string>> = {
  tasks: "checklist",
  due: "calendar",
  graph: "type-hierarchy",
  broken: "warning",
  orphans: "circle-slash",
};
