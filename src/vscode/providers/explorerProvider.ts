import * as vscode from "vscode";
import type { WorkspaceIndex } from "../../indexing/workspaceIndex";
import {
  type ExplorerNode,
  ROOT_NODES,
  noteChildren,
  notesWithTag,
  orphanNotes,
  smartViews,
  tagNodes,
} from "./explorerModel";
import { openRenderedNoteCommand, smartViewCommand } from "./explorerCommands";

export class NotesExplorerProvider
  implements vscode.TreeDataProvider<ExplorerNode>, vscode.Disposable
{
  private readonly changeEmitter = new vscode.EventEmitter<ExplorerNode | undefined>();
  private readonly subscriptions: vscode.Disposable[];

  readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor(private readonly index: WorkspaceIndex) {
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
        return [...noteChildren(this.index.snapshot)];
      }
      return node.id === "smart"
        ? [...smartViews(this.index.snapshot)]
        : [...tagNodes(this.index.snapshot)];
    }
    if (node.kind === "folder") {
      return [...noteChildren(this.index.snapshot, node.path)];
    }
    if (node.kind === "tag") {
      return [...notesWithTag(this.index.snapshot, node.tag)];
    }
    if (node.kind === "smart" && node.id === "orphans") {
      return [...orphanNotes(this.index.snapshot)];
    }
    return [];
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
    item.id = `folder:${node.path}`;
    item.contextValue = "vispNotes.folder";
    item.iconPath = vscode.ThemeIcon.Folder;
    return item;
  }

  private noteItem(node: Extract<ExplorerNode, { kind: "note" }>): vscode.TreeItem {
    const uri = vscode.Uri.parse(node.note.uri);
    const item = new vscode.TreeItem(node.note.title, vscode.TreeItemCollapsibleState.None);
    item.id = `note:${node.note.uri}`;
    item.contextValue = "vispNotes.note";
    item.description = node.note.fileName === `${node.note.title}.md` ? undefined : node.note.fileName;
    item.iconPath = new vscode.ThemeIcon("note");
    item.resourceUri = uri;
    item.tooltip = `${node.note.title}\n${node.note.path}`;
    item.command = openRenderedNoteCommand(uri);
    return item;
  }

  private smartItem(node: Extract<ExplorerNode, { kind: "smart" }>): vscode.TreeItem {
    const expandable = node.id === "orphans" && (node.count ?? 0) > 0;
    const item = new vscode.TreeItem(
      node.label,
      expandable ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
    );
    item.id = `smart:${node.id}`;
    item.contextValue = `vispNotes.smart.${node.id}`;
    item.description = node.count === undefined ? undefined : String(node.count);
    item.iconPath = new vscode.ThemeIcon(SMART_ICONS[node.id]);
    item.command = smartViewCommand(node.id);
    return item;
  }

  private tagItem(node: Extract<ExplorerNode, { kind: "tag" }>): vscode.TreeItem {
    const item = new vscode.TreeItem(`#${node.tag}`, vscode.TreeItemCollapsibleState.Collapsed);
    item.id = `tag:${node.tag.toLocaleLowerCase()}`;
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
