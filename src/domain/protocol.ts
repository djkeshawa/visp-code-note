import type { Backlink, GraphData, IndexSnapshot, NoteContext } from "./models";

export type EditorContentWidth = "readable" | "wide" | "full";

export interface EditorDocumentState {
  readonly title: string;
  readonly source: string;
  readonly unresolvedLinks: readonly string[];
  readonly version: number;
  readonly dirty: boolean;
  readonly acknowledgedSequence?: number;
  readonly context?: NoteContext;
}

export interface EditorState extends EditorDocumentState {
  readonly uri: string;
  readonly noteSuggestions: readonly NoteSuggestion[];
  readonly contentWidth: EditorContentWidth;
  readonly recoveredDraft?: RecoveredDraft;
}

export interface RecoveredDraft {
  readonly source: string;
  readonly saveRequested: boolean;
}

export interface NoteSuggestion {
  readonly label: string;
  readonly target: string;
  readonly path: string;
  readonly aliases: readonly string[];
  readonly referenceTarget: string;
  readonly headings: readonly string[];
  readonly blockIds: readonly string[];
}

export type HostToEditorMessage =
  | { readonly type: "editor/state"; readonly state: EditorState }
  | { readonly type: "editor/documentState"; readonly state: EditorDocumentState }
  | { readonly type: "editor/toggleMode" }
  | { readonly type: "editor/reveal"; readonly offset: number }
  | { readonly type: "editor/insertLink"; readonly target: string }
  | { readonly type: "editor/insertTag"; readonly tag: string }
  | { readonly type: "editor/removeTag"; readonly tag: string }
  | { readonly type: "editor/contentWidth"; readonly contentWidth: EditorContentWidth }
  | {
      readonly type: "editor/indexState";
      readonly suggestions: readonly NoteSuggestion[];
      readonly unresolvedLinks: readonly string[];
    }
  | {
      readonly type: "editor/error";
      readonly operation: "sync" | "link";
      readonly message: string;
    };

export type EditorToHostMessage =
  | {
      readonly type: "editor/editSource";
      readonly start: number;
      readonly end: number;
      readonly source: string;
      readonly expectedSource: string;
      readonly version: number;
      readonly sequence: number;
      readonly save?: boolean;
    }
  | { readonly type: "editor/save" }
  | {
      readonly type: "editor/stashDraft";
      readonly source: string;
      readonly saveRequested: boolean;
    }
  | { readonly type: "editor/discardDraft"; readonly version: number }
  | { readonly type: "editor/requestLink" }
  | { readonly type: "editor/requestTag" }
  | { readonly type: "editor/openLink"; readonly target: string; readonly beside?: boolean }
  | { readonly type: "editor/setContentWidth"; readonly contentWidth: EditorContentWidth }
  | { readonly type: "editor/ready" };

export type HostToTasksMessage =
  | { readonly type: "tasks/state"; readonly snapshot: TasksState }
  | { readonly type: "tasks/error"; readonly message: string };

export interface TasksState {
  readonly tasks: IndexSnapshot["tasks"];
  readonly version: number;
  readonly indexedAt: number;
  readonly filter: "all" | "today";
}

export type TasksToHostMessage =
  | {
      readonly type: "tasks/toggle";
      readonly noteUri: string;
      readonly start: number;
      readonly taskId?: string;
      readonly completed: boolean;
      readonly version: number;
    }
  | { readonly type: "tasks/open"; readonly noteUri: string; readonly start: number }
  | { readonly type: "tasks/ready" };

export type HostToGraphMessage = {
  readonly type: "graph/state";
  readonly graph: GraphData;
  readonly depth: 1 | 2;
  readonly local: boolean;
};

export type GraphToHostMessage =
  | { readonly type: "graph/open"; readonly uri: string }
  | { readonly type: "graph/depth"; readonly depth: 1 | 2 }
  | { readonly type: "graph/ready" };

export interface BacklinksState {
  readonly noteUri?: string;
  readonly noteTitle?: string;
  readonly backlinks: readonly Backlink[];
  readonly outgoingCount: number;
  readonly taskCount: number;
}

export type HostToBacklinksMessage = {
  readonly type: "backlinks/state";
  readonly state: BacklinksState;
};

export type BacklinksToHostMessage =
  | { readonly type: "backlinks/open"; readonly uri: string; readonly start: number }
  | { readonly type: "backlinks/ready" };
