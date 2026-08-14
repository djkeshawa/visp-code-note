import type {
  GraphData,
  IndexSnapshot,
  NoteContext,
  SkippedNote,
  TaskPriority,
} from "./models";

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
  /** Absent when rendered prose should follow the interface font. */
  readonly proseFont?: string;
  readonly recoveredDraft?: RecoveredDraft;
  /** Workspace-wide, shown beside Find Broken Links in the note's overflow menu. */
  readonly brokenLinkCount: number;
  /** Whether the inspector column beside the note is showing. */
  readonly showInspector: boolean;
  /** Words the reader has accepted, so the checker knows them on open. */
  readonly personalDictionary: readonly string[];
  /** Whether misspellings are underlined at all. */
  readonly spellingEnabled: boolean;
}

/**
 * Actions the note's overflow menu delegates to the extension host. Each maps to a
 * contributed command, so the menu and the command palette cannot drift apart.
 */
export type EditorMenuCommand =
  | "newTask"
  | "renameNote"
  | "findBrokenLinks"
  | "openLocalGraph"
  | "rebuildIndex";

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
  | { readonly type: "editor/proseFont"; readonly fontFamily?: string }
  | { readonly type: "editor/contentWidth"; readonly contentWidth: EditorContentWidth }
  | { readonly type: "editor/showInspector"; readonly showInspector: boolean }
  | { readonly type: "editor/spelling"; readonly enabled: boolean }
  | {
      /*
       * Everything about a note that comes from the index rather than from its own text.
       * The context rides here as well as on a document publish: a note gains a backlink
       * when some *other* note is edited, and this is the only message that note's editor
       * receives when that happens.
       */
      readonly type: "editor/indexState";
      readonly suggestions: readonly NoteSuggestion[];
      readonly unresolvedLinks: readonly string[];
      readonly brokenLinkCount: number;
      readonly context?: NoteContext;
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
  | { readonly type: "editor/openExternal"; readonly url: string }
  | { readonly type: "editor/openBacklink"; readonly uri: string; readonly start: number }
  | { readonly type: "editor/runCommand"; readonly command: EditorMenuCommand }
  | { readonly type: "editor/compareDraft"; readonly source: string }
  | { readonly type: "editor/setContentWidth"; readonly contentWidth: EditorContentWidth }
  | { readonly type: "editor/setInspectorVisible"; readonly showInspector: boolean }
  | { readonly type: "editor/addDictionaryWord"; readonly word: string }
  | { readonly type: "editor/ready" };

export type HostToTasksMessage =
  | { readonly type: "tasks/state"; readonly snapshot: TasksState }
  | { readonly type: "tasks/error"; readonly message: string };

/** An upcoming reminder, already decided by the host so the panel only has to draw it. */
export interface TaskReminder {
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

export interface TasksState {
  readonly tasks: IndexSnapshot["tasks"];
  /** The soonest few, capped — see `ACTIVE_REMINDER_LIMIT`. */
  readonly reminders: readonly TaskReminder[];
  /** How many are actually armed, which is what the panel counts. */
  readonly reminderCount: number;
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

/**
 * The note list: orphans, links that land nowhere, and the notes carrying a tag.
 *
 * A panel rather than a quick pick, because none of these is glanced at — they are lists
 * worked through, one row compared against the next.
 */
export type NoteListing =
  | { readonly kind: "orphans" }
  | { readonly kind: "broken" }
  | { readonly kind: "tag"; readonly tag: string };

export interface NoteListRow {
  readonly uri: string;
  readonly title: string;
  readonly path: string;
  readonly detail?: string;
  readonly tags?: readonly string[];
  readonly start?: number;
  readonly line?: number;
}

export interface NotesState {
  readonly listing: NoteListing;
  readonly rows: readonly NoteListRow[];
  readonly indexedAt: number;
}

export type HostToNotesMessage =
  | { readonly type: "notes/state"; readonly state: NotesState }
  | { readonly type: "notes/error"; readonly message: string };

export type NotesToHostMessage =
  | { readonly type: "notes/open"; readonly uri: string; readonly start?: number }
  | { readonly type: "notes/ready" };

export type HostToGraphMessage = {

  readonly type: "graph/state";
  readonly graph: GraphData;
  readonly depth: 1 | 2;
  readonly local: boolean;
};

/** The graph's overflow menu, delegated to contributed commands like the note editor's. */
export type GraphMenuCommand = "openWorkspaceGraph" | "rebuildIndex";

export type GraphToHostMessage =
  | { readonly type: "graph/open"; readonly uri: string }
  | { readonly type: "graph/depth"; readonly depth: 1 | 2 }
  | { readonly type: "graph/runCommand"; readonly command: GraphMenuCommand }
  | { readonly type: "graph/ready" };

/**
 * The workspace panel.
 *
 * The design draws this as a panel, not as a tree: a search field inside it, labelled section
 * rules, a colour per tag, a connectedness dot per note, and a status line along the bottom.
 * A `TreeView` can express none of those, so the panel is a webview and this is what the host
 * sends it. Every figure is derived from the index; the panel decides nothing for itself
 * except which sections are open.
 */
export type WorkspaceViewTone = "default" | "brand" | "warning";

export interface WorkspaceViewRow {
  readonly id: "tasks" | "due" | "graph" | "broken" | "orphans";
  readonly label: string;
  readonly icon: string;
  readonly count?: number;
  readonly tone: WorkspaceViewTone;
}

export interface WorkspaceTaskRow {
  readonly noteUri: string;
  readonly noteTitle: string;
  readonly start: number;
  readonly id?: string;
  readonly text: string;
  readonly completed: boolean;
  readonly due?: string;
  readonly priority?: TaskPriority;
}

export interface WorkspaceNoteRow {
  readonly uri: string;
  readonly title: string;
  readonly path: string;
  /** The folder holding the note, empty at the workspace root. */
  readonly folder: string;
  /** How many other notes it is connected to. */
  readonly links: number;
}

export interface WorkspaceFolderRow {
  readonly path: string;
  readonly label: string;
  readonly count: number;
}

export interface WorkspaceTagRow {
  readonly name: string;
  readonly count: number;
}

export type WorkspaceDensity = "comfortable" | "compact";

export interface WorkspacePanelState {
  readonly density: WorkspaceDensity;
  /**
   * Whether the window has a folder open at all. An index holding no notes looks identical
   * either way, and the two are different problems: one is answered by opening a folder, the
   * other by writing the first note.
   */
  readonly hasWorkspaceFolder: boolean;
  readonly views: readonly WorkspaceViewRow[];
  /** Late or landing today, capped for the wire; the row's count carries the true total. */
  readonly dueToday: readonly WorkspaceTaskRow[];
  readonly folders: readonly WorkspaceFolderRow[];
  readonly notes: readonly WorkspaceNoteRow[];
  readonly tags: readonly WorkspaceTagRow[];
  readonly noteCount: number;
  readonly taskCount: number;
  /**
   * The files the size limit left out. Whole entries rather than a count, because the footer
   * says why as well as how many, and it says it in the same words as the status bar item —
   * which it can only do by running the same function over the same facts.
   */
  readonly skippedOversized: readonly SkippedNote[];
  readonly indexedAt: number;
  readonly status: "idle" | "indexing" | "error";
  readonly version: number;
  readonly activeNoteUri?: string;
}

export type HostToWorkspaceMessage =
  | { readonly type: "workspace/state"; readonly state: WorkspacePanelState }
  /**
   * Just the current note. Switching notes moves one field, and the full state runs to about
   * 75KB on a 570-note workspace — not something to serialise for a highlight change.
   */
  | { readonly type: "workspace/activeNote"; readonly uri?: string }
  /**
   * Which notes the panel's filter query matches by content. The panel filters titles and
   * paths itself; note text never rides to a webview, so it asks and the host answers from
   * the search index. Tagged with the query so a stale answer is recognisable.
   */
  | { readonly type: "workspace/filterMatches"; readonly query: string; readonly uris: readonly string[] }
  | { readonly type: "workspace/error"; readonly message: string };

/** What the panel's header and row menus delegate to the host. */
/**
 * What the panel itself can ask the host to run. Everything else it offers — new task,
 * rebuild, the workspace graph — is a contributed view-title action, which VS Code
 * dispatches without the webview being involved.
 *
 * `newNote` is here as well as in the view title because the empty panel has to offer it
 * where the reader is looking, which is the middle of the list, not the header.
 */
export type WorkspaceMenuCommand = "search" | "newNote";

/** What a note row's own context menu offers, beyond opening the note. */
export type WorkspaceNoteAction = "rename" | "graph" | "delete";

export type WorkspaceToHostMessage =
  | { readonly type: "workspace/ready" }
  /** The filter box's current query, sent so the host can say which notes match by content. */
  | { readonly type: "workspace/filter"; readonly query: string }
  | { readonly type: "workspace/openNote"; readonly uri: string }
  | { readonly type: "workspace/openView"; readonly id: WorkspaceViewRow["id"] }
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
  | { readonly type: "workspace/runCommand"; readonly command: WorkspaceMenuCommand }
  | {
      readonly type: "workspace/noteAction";
      readonly action: WorkspaceNoteAction;
      readonly uri: string;
    };
