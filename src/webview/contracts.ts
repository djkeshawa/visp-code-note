export interface OffsetRangeWire {
  readonly start: number;
  readonly end: number;
}

export type EditorContentWidthWire = "readable" | "wide" | "full";

export interface NoteBacklinkContextWire {
  readonly uri: string;
  readonly title: string;
  readonly line: number;
  readonly start: number;
  readonly context: string;
}

export interface NoteOutgoingLinkContextWire {
  readonly label: string;
  readonly target: string;
  readonly resolved: boolean;
}

export interface NoteContextWire {
  readonly folders: readonly string[];
  readonly fileName: string;
  readonly tags: readonly string[];
  readonly frontmatterTags: readonly string[];
  readonly backlinkCount: number;
  readonly outgoingCount: number;
  readonly taskCount: number;
  readonly openTaskCount: number;
  readonly backlinks: readonly NoteBacklinkContextWire[];
  readonly linksOut: readonly NoteOutgoingLinkContextWire[];
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
  readonly brokenLinkCount: number;
  readonly showInspector: boolean;
  /** Words the reader has accepted, so the checker knows them on open. */
  readonly personalDictionary: readonly string[];
  /** Whether misspellings are underlined at all. */
  readonly spellingEnabled: boolean;
  /** Every tag in the workspace, most used first, for the `#` completion. */
  readonly workspaceTags: readonly string[];
}

export type EditorMenuCommandWire =
  | "newTask"
  | "renameNote"
  | "findBrokenLinks"
  | "openLocalGraph"
  | "rebuildIndex";

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

/** Mirrors `EditorInlineMark`. `INLINE_MARKS` takes its own id type from this. */
export type EditorInlineMarkWire = "bold" | "italic" | "inline-code" | "strikethrough";

export type HostToEditorWire =
  | { readonly type: "editor/state"; readonly state: EditorStateWire }
  | { readonly type: "editor/documentState"; readonly state: EditorDocumentStateWire }
  | { readonly type: "editor/toggleMode" }
  | { readonly type: "editor/reveal"; readonly offset: number }
  | { readonly type: "editor/insertLink"; readonly target: string }
  | { readonly type: "editor/insertTag"; readonly tag: string }
  | { readonly type: "editor/removeTag"; readonly tag: string }
  | { readonly type: "editor/format"; readonly mark: EditorInlineMarkWire }
  | { readonly type: "editor/proseFont"; readonly fontFamily?: string }
  | { readonly type: "editor/contentWidth"; readonly contentWidth: EditorContentWidthWire }
  | { readonly type: "editor/showInspector"; readonly showInspector: boolean }
  | { readonly type: "editor/spelling"; readonly enabled: boolean }
  | {
      readonly type: "editor/indexState";
      readonly suggestions: readonly NoteSuggestionWire[];
      readonly unresolvedLinks: readonly string[];
      readonly brokenLinkCount: number;
      readonly context?: NoteContextWire;
      readonly workspaceTags: readonly string[];
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
  | { readonly type: "editor/openBacklink"; readonly uri: string; readonly start: number }
  | { readonly type: "editor/runCommand"; readonly command: EditorMenuCommandWire }
  | { readonly type: "editor/compareDraft"; readonly source: string }
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
  | { readonly type: "editor/setInspectorVisible"; readonly showInspector: boolean }
  | { readonly type: "editor/addDictionaryWord"; readonly word: string }
  | { readonly type: "editor/ready" };

interface NoteTaskWire {
  readonly id?: string;
  readonly text: string;
  readonly completed: boolean;
  readonly due?: string;
  readonly remind?: string;
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
  readonly noteCreatedAt?: number;
};

/** An upcoming reminder, already decided by the host so the panel only has to draw it. */
export interface TaskReminderWire {
  readonly noteUri: string;
  readonly noteTitle: string;
  readonly start: number;
  readonly text: string;
  readonly due?: string;
  /** When the reminder fires. */
  readonly at: number;
  /** When the task is due, which is what the row says. */
  readonly dueAt: number;
}

export interface TasksSnapshotWire {
  readonly tasks: readonly TaskWire[];
  /** The soonest few, capped by the host; `reminderCount` is the true total. */
  readonly reminders: readonly TaskReminderWire[];
  readonly reminderCount: number;
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

export type NoteListingWire =
  | { readonly kind: "orphans" }
  | { readonly kind: "broken" }
  | { readonly kind: "recent" }
  | { readonly kind: "tag"; readonly tag: string };

export interface NoteListRowWire {
  readonly uri: string;
  readonly title: string;
  readonly path: string;
  readonly detail?: string;
  readonly tags?: readonly string[];
  readonly start?: number;
  readonly line?: number;
  /** When the file was last written, for a list that is about time. */
  readonly modifiedAt?: number;
}

export interface NotesStateWire {
  readonly listing: NoteListingWire;
  readonly rows: readonly NoteListRowWire[];
  readonly indexedAt: number;
}

export type HostToNotesWire =
  | { readonly type: "notes/state"; readonly state: NotesStateWire }
  | { readonly type: "notes/error"; readonly message: string };

export type NotesToHostWire =
  | { readonly type: "notes/open"; readonly uri: string; readonly start?: number }
  | { readonly type: "notes/ready" };

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

export type GraphMenuCommandWire = "openWorkspaceGraph" | "rebuildIndex";

export type GraphToHostWire =
  | { readonly type: "graph/open"; readonly uri: string }
  | { readonly type: "graph/focus"; readonly uri: string }
  | { readonly type: "graph/depth"; readonly depth: 1 | 2 }
  | { readonly type: "graph/runCommand"; readonly command: GraphMenuCommandWire }
  | { readonly type: "graph/ready" };

export type WorkspaceViewToneWire = "default" | "brand" | "warning";

export interface WorkspaceViewRowWire {
  readonly id: "tasks" | "due" | "graph" | "broken" | "orphans" | "recent";
  readonly label: string;
  readonly icon: string;
  readonly count?: number;
  readonly tone: WorkspaceViewToneWire;
  /** What the view is, where its label could be read as promising something it cannot do. */
  readonly hint?: string;
}

export interface WorkspaceTaskRowWire {
  readonly noteUri: string;
  readonly noteTitle: string;
  readonly start: number;
  readonly id?: string;
  readonly text: string;
  readonly completed: boolean;
  readonly due?: string;
  readonly priority?: "low" | "medium" | "high";
}

export interface WorkspaceNoteRowWire {
  readonly uri: string;
  readonly title: string;
  readonly path: string;
  readonly folder: string;
  readonly links: number;
}

/** One folder in the panel's tree, at whatever depth it sits. Mirrors `WorkspaceFolderRow`. */
export interface WorkspaceFolderRowWire {
  readonly path: string;
  /** The last segment; the rest of the path is said by the indentation. */
  readonly label: string;
  /** Notes anywhere beneath it, so a closed folder still reports what it holds. */
  readonly count: number;
  readonly depth: number;
  readonly parent?: string;
}

export interface WorkspaceTagRowWire {
  readonly name: string;
  readonly count: number;
}

/** A Markdown file the size limit kept out of the index. Mirrors `SkippedNote`. */
export interface SkippedNoteWire {
  readonly uri: string;
  readonly path: string;
  readonly sizeBytes: number;
  readonly limitBytes: number;
}

export type WorkspaceDensityWire = "comfortable" | "compact";

export interface WorkspacePanelStateWire {
  readonly density: WorkspaceDensityWire;
  /** Whether the window has a folder open at all, which decides what an empty list says. */
  readonly hasWorkspaceFolder: boolean;
  readonly views: readonly WorkspaceViewRowWire[];
  readonly dueToday: readonly WorkspaceTaskRowWire[];
  readonly folders: readonly WorkspaceFolderRowWire[];
  readonly notes: readonly WorkspaceNoteRowWire[];
  readonly tags: readonly WorkspaceTagRowWire[];
  readonly noteCount: number;
  readonly taskCount: number;
  readonly skippedOversized: readonly SkippedNoteWire[];
  readonly indexedAt: number;
  readonly status: "idle" | "indexing" | "error";
  readonly version: number;
  readonly activeNoteUri?: string;
}

export type HostToWorkspaceWire =
  | { readonly type: "workspace/state"; readonly state: WorkspacePanelStateWire }
  | { readonly type: "workspace/activeNote"; readonly uri?: string }
  /**
   * Which notes the panel's filter query matches by content. The panel filters titles and
   * paths itself; note text never rides to a webview, so it asks and the host answers from
   * the search index. Tagged with the query so a stale answer is recognisable.
   */
  | { readonly type: "workspace/filterMatches"; readonly query: string; readonly uris: readonly string[] }
  | { readonly type: "workspace/error"; readonly message: string };

export type WorkspaceMenuCommandWire = "search" | "newNote";

export type WorkspaceNoteActionWire = "rename" | "graph" | "delete";

export type WorkspaceToHostWire =
  | { readonly type: "workspace/ready" }
  /** The filter box's current query, sent so the host can say which notes match by content. */
  | { readonly type: "workspace/filter"; readonly query: string }
  | { readonly type: "workspace/openNote"; readonly uri: string }
  | { readonly type: "workspace/openView"; readonly id: WorkspaceViewRowWire["id"] }
  | { readonly type: "workspace/openTag"; readonly tag: string }
  | {
      readonly type: "workspace/toggleTask";
      readonly noteUri: string;
      readonly start: number;
      readonly taskId?: string;
      readonly completed: boolean;
      readonly version: number;
    }
  | { readonly type: "workspace/revealTask"; readonly noteUri: string; readonly start: number }
  | { readonly type: "workspace/runCommand"; readonly command: WorkspaceMenuCommandWire }
  | {
      readonly type: "workspace/noteAction";
      readonly action: WorkspaceNoteActionWire;
      readonly uri: string;
    };
