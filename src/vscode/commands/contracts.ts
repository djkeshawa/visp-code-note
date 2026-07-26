import type * as vscode from "vscode";
import type { IndexSnapshot, NoteRecord } from "../../domain/models";

export interface CommandIndex {
  readonly snapshot: IndexSnapshot;
  rebuild(): Promise<void>;
  refresh(uri: vscode.Uri): Promise<void>;
  move(previousUri: vscode.Uri, nextUri: vscode.Uri): Promise<void>;
  findNote(uri: vscode.Uri | string): NoteRecord | undefined;
}

export interface FeatureViews {
  openTasks(filter?: "all" | "today"): void;
  openGraph(focusUri?: string): void;
  showBacklinks(uri?: string): Promise<void>;
  toggleEditor(uri?: vscode.Uri): Promise<void>;
  activeNoteUri(): vscode.Uri | undefined;
  insertLink(target: string): Promise<boolean>;
  insertTag(tag: string): Promise<boolean>;
  removeTag(tag: string): Promise<boolean>;
  showDiffPreview(title: string, before: string, after: string): Promise<void>;
}
