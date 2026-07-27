export interface OffsetRangeWire {
  readonly start: number;
  readonly end: number;
}

export type EditorContentWidthWire = "readable" | "wide" | "full";

export interface NoteContextWire {
  readonly folders: readonly string[];
  readonly fileName: string;
  readonly tags: readonly string[];
  readonly frontmatterTags: readonly string[];
  readonly backlinkCount: number;
  readonly outgoingCount: number;
  readonly taskCount: number;
  readonly openTaskCount: number;
}

export interface EditorDocumentStateWire {
  readonly title: string;
  readonly source: string;
  readonly unresolvedLinks: readonly string[];
  readonly version: number;
  readonly dirty: boolean;
  readonly acknowledgedSequence?: number;
  readonly context?: NoteContextWire;
}

export interface EditorStateWire extends EditorDocumentStateWire {
  readonly uri: string;
  readonly noteSuggestions: readonly NoteSuggestionWire[];
  readonly contentWidth: EditorContentWidthWire;
  readonly proseFont?: string;
  readonly recoveredDraft?: RecoveredDraftWire;
}

export interface RecoveredDraftWire {
  readonly source: string;
  readonly saveRequested: boolean;
}

export interface NoteSuggestionWire {
  readonly label: string;
  readonly target: string;
  readonly path: string;
  readonly aliases: readonly string[];
  readonly referenceTarget: string;
  readonly headings: readonly string[];
  readonly blockIds: readonly string[];
}

export type HostToEditorWire =
  | { readonly type: "editor/state"; readonly state: EditorStateWire }
  | { readonly type: "editor/documentState"; readonly state: EditorDocumentStateWire }
  | { readonly type: "editor/toggleMode" }
  | { readonly type: "editor/reveal"; readonly offset: number }
  | { readonly type: "editor/insertLink"; readonly target: string }
  | { readonly type: "editor/insertTag"; readonly tag: string }
  | { readonly type: "editor/removeTag"; readonly tag: string }
  | { readonly type: "editor/proseFont"; readonly fontFamily?: string }
  | { readonly type: "editor/contentWidth"; readonly contentWidth: EditorContentWidthWire }
  | {
      readonly type: "editor/indexState";
      readonly suggestions: readonly NoteSuggestionWire[];
      readonly unresolvedLinks: readonly string[];
    }
  | {
      readonly type: "editor/error";
      readonly operation: "sync" | "link";
      readonly message: string;
    };

export type EditorToHostWire =
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
  | { readonly type: "editor/openLink"; readonly target: string; readonly beside?: boolean }
  | { readonly type: "editor/openExternal"; readonly url: string }
  | { readonly type: "editor/save" }
  | {
      readonly type: "editor/stashDraft";
      readonly source: string;
      readonly saveRequested: boolean;
    }
  | { readonly type: "editor/discardDraft"; readonly version: number }
  | { readonly type: "editor/requestLink" }
  | { readonly type: "editor/requestTag" }
  | { readonly type: "editor/setContentWidth"; readonly contentWidth: EditorContentWidthWire }
  | { readonly type: "editor/ready" };

interface NoteTaskWire {
  readonly id?: string;
  readonly text: string;
  readonly completed: boolean;
  readonly due?: string;
  readonly priority?: "low" | "medium" | "high";
  readonly tags: readonly string[];
  readonly range: OffsetRangeWire;
  readonly checkboxRange: OffsetRangeWire;
  readonly line: number;
}

export type TaskWire = NoteTaskWire & {
  readonly noteUri: string;
  readonly noteTitle: string;
  readonly notePath: string;
};

export interface TasksSnapshotWire {
  readonly tasks: readonly TaskWire[];
  readonly version: number;
  readonly indexedAt: number;
  readonly filter: "all" | "today";
}

export type HostToTasksWire =
  | { readonly type: "tasks/state"; readonly snapshot: TasksSnapshotWire }
  | { readonly type: "tasks/error"; readonly message: string };

export type TasksToHostWire =
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

export type GraphNodeKindWire = "note" | "task" | "tag" | "unresolved";

export interface GraphNodeWire {
  readonly id: string;
  readonly label: string;
  readonly kind: GraphNodeKindWire;
  readonly uri?: string;
  readonly orphan?: boolean;
}

export interface GraphEdgeWire {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly kind: "link" | "task" | "tag";
}

export interface GraphDataWire {
  readonly nodes: readonly GraphNodeWire[];
  readonly edges: readonly GraphEdgeWire[];
  readonly focusId?: string;
}

export type HostToGraphWire = {
  readonly type: "graph/state";
  readonly graph: GraphDataWire;
  readonly depth: 1 | 2;
  readonly local: boolean;
};

export type GraphToHostWire =
  | { readonly type: "graph/open"; readonly uri: string }
  | { readonly type: "graph/depth"; readonly depth: 1 | 2 }
  | { readonly type: "graph/ready" };

export interface BacklinkWire {
  readonly sourceUri: string;
  readonly sourceTitle: string;
  readonly sourcePath: string;
  readonly targetUri: string;
  readonly range: OffsetRangeWire;
  readonly context: string;
  readonly line: number;
}

export interface BacklinksStateWire {
  readonly noteUri?: string;
  readonly noteTitle?: string;
  readonly backlinks: readonly BacklinkWire[];
  readonly outgoingCount: number;
  readonly taskCount: number;
}

export type HostToBacklinksWire = {
  readonly type: "backlinks/state";
  readonly state: BacklinksStateWire;
};

export type BacklinksToHostWire =
  | { readonly type: "backlinks/open"; readonly uri: string; readonly start: number }
  | { readonly type: "backlinks/ready" };
