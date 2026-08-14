import type * as vscode from "vscode";
import type { IndexSnapshot, NoteRecord } from "../../domain/models";
import type { EditorInlineMark, NoteListing } from "../../domain/protocol";

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
  /** Opens the note list in the window: orphans, broken links, or a tag's notes. */
  openNotesList(listing: NoteListing): void;
  /** Opens the note in its rendered editor with the inspector showing. */
  showBacklinks(uri?: string): Promise<void>;
  toggleEditor(uri?: vscode.Uri): Promise<void>;
  activeNoteUri(): vscode.Uri | undefined;
  insertLink(target: string): Promise<boolean>;
  /** Toggles one of the note editor's inline marks over whatever it has selected. */
  formatInline(mark: EditorInlineMark): Promise<boolean>;
  insertTag(tag: string): Promise<boolean>;
  removeTag(tag: string): Promise<boolean>;
  showDiffPreview(title: string, before: string, after: string): Promise<void>;
}
