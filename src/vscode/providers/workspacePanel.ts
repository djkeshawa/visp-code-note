import * as vscode from "vscode";
import type {
  HostToWorkspaceMessage,
  WorkspaceFolderRow,
  WorkspaceMenuCommand,
  NoteListing,
  WorkspaceNoteAction,
  WorkspaceNoteRow,
  WorkspacePanelState,
  WorkspaceTaskRow,
  WorkspaceDensity,
  WorkspaceViewRow,
} from "../../domain/protocol";
import type { IndexSnapshot } from "../../domain/models";
import { getBrokenLinks, getOrphanNotes } from "../../indexing/projections";
import type { WorkspaceIndex } from "../../indexing/workspaceIndex";
import { createWorkspaceHtml } from "../../ui";
import { COMMAND_IDS } from "../ids";
import { isWorkspaceMessage } from "./messageValidation";
import { noteLinkCounts, todayStamp } from "./explorerModel";
import { selectDueTasks } from "../../application/dueTasks";
import type { DueSelection } from "../../application/dueTasks";
import { matchingNoteUris } from "../../application/workspaceSearch";

/**
 * How many task rows ride to the panel.
 *
 * The row's count is the true total; this only bounds what is drawn. A workspace that has let
 * a few hundred tasks slip would otherwise serialise all of them on every publish, for a list
 * nobody scrolls to the end of.
 */
const DUE_ROW_LIMIT = 50;

/**
 * How many content-matched note URIs ride back to the panel for one filter query. The panel
 * draws at most 200 note rows; a one-letter query matches most of a vault, and serialising
 * every URI it matches would cost hundreds of kilobytes for rows nobody can see.
 */
const FILTER_MATCH_LIMIT = 500;

/**
 * What the panel's header and row actions may ask the host to run.
 *
 * A map, not a command id off the wire. The panel is a webview drawing titles and tags out of
 * files this extension declares itself able to open untrusted, so a message naming its own
 * command id would let a note reach `vscode.commands.executeCommand`. Every id here is one of
 * this extension's own, and each is run with no arguments — `newNote` asks for the title
 * itself, so the reader still types what is written and where it goes.
 */
const MENU_COMMANDS: Readonly<Record<WorkspaceMenuCommand, string>> = {
  search: COMMAND_IDS.search,
  newNote: COMMAND_IDS.newNote,
};

/** What a note row's own menu may run. Each confirms for itself where it needs to. */
const NOTE_ACTION_COMMANDS: Readonly<Record<WorkspaceNoteAction, string>> = {
  rename: COMMAND_IDS.renameNote,
  graph: COMMAND_IDS.openLocalGraph,
  delete: COMMAND_IDS.deleteNote,
};

const SMART_VIEWS: readonly { readonly id: WorkspaceViewRow["id"]; readonly label: string; readonly icon: string }[] = [
  /*
   * Today's work first: it is the only one of these that is about the next few hours. Work that
   * slipped its date counts as today's — scoped strictly to the current date, a task that missed
   * its day left the list, and the row went quiet exactly when something had been forgotten.
   */
  { id: "due", label: "Due Today", icon: "calendar" },
  { id: "tasks", label: "All Tasks", icon: "checklist" },
  { id: "graph", label: "Knowledge Graph", icon: "type-hierarchy" },
  { id: "broken", label: "Broken Links", icon: "warning" },
  { id: "orphans", label: "Orphan Notes", icon: "circle-slash" },
];

export interface WorkspacePanelActions {
  readonly openNote: (uri: string) => Promise<void>;
  readonly openTasks: (filter: "all" | "today") => void;
  readonly openGraph: (focusUri?: string) => void;
  readonly openNotesList: (listing: NoteListing) => void;
  readonly revealTask: (noteUri: string, start: number) => Promise<void>;
  readonly toggleTask: (
    noteUri: string,
    start: number,
    taskId: string | undefined,
    completed: boolean,
    version: number,
  ) => Promise<void>;
}

/**
 * The workspace panel: what the side bar shows.
 *
 * A webview rather than a `TreeView` because the design is a panel — a search field inside it,
 * sections divided by a labelled rule, a colour per tag, a connectedness dot per note, and a
 * status line along the bottom. None of that is expressible through a tree item's label, icon,
 * description and checkbox.
 */
export class WorkspacePanel implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private readonly subscriptions: vscode.Disposable[];
  private viewSubscriptions: vscode.Disposable[] = [];
  private activeNoteUri: string | undefined;
  /**
   * Everything in the panel's state that comes from the index, cached against the snapshot it
   * was derived from.
   *
   * Measured on a 570-note workspace with 2,850 links: deriving it costs about 37ms, of which
   * `getBrokenLinks` alone is 30ms because it re-resolves every wiki reference in the
   * workspace. The panel publishes on far more than an index change — switching notes, and
   * changing a setting, both did all of that work again for figures that had not moved.
   *
   * Keyed on the day as well as the snapshot, because what counts as overdue moves with it.
   */
  private derived: { key: string; state: DerivedPanelState } | undefined;
  /** Set when the index moved while the panel was hidden. */
  private publishPending = false;

  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly index: WorkspaceIndex,
    private readonly actions: WorkspacePanelActions,
  ) {
    this.subscriptions = [
      index.onDidChange(() => this.publish()),
      index.onDidChangeStatus(() => this.publish()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("vispNotes.density")) this.publish();
      }),
    ];
  }

  public resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
    };
    view.webview.html = createWorkspaceHtml({
      webview: view.webview,
      extensionUri: this.extensionUri,
    });
    for (const disposable of this.viewSubscriptions.splice(0)) disposable.dispose();
    this.viewSubscriptions = [
      view.webview.onDidReceiveMessage((message: unknown) => void this.handleMessage(message)),
      view.onDidChangeVisibility(() => {
        if (view.visible && this.publishPending) this.publish();
      }),
      view.onDidDispose(() => {
        if (this.view === view) this.view = undefined;
      }),
    ];
  }

  /** Marks the note the panel should show as current. */
  public setActiveNote(uri: string | undefined): void {
    if (this.activeNoteUri === uri) return;
    this.activeNoteUri = uri;
    void this.view?.webview.postMessage({
      type: "workspace/activeNote",
      ...(uri === undefined ? {} : { uri }),
    } satisfies HostToWorkspaceMessage);
  }

  public dispose(): void {
    for (const disposable of this.viewSubscriptions.splice(0)) disposable.dispose();
    vscode.Disposable.from(...this.subscriptions).dispose();
  }

  private async handleMessage(value: unknown): Promise<void> {
    if (!isWorkspaceMessage(value)) return;
    const message = value;
    try {
      switch (message.type) {
        case "workspace/ready":
          this.publish();
          break;
        case "workspace/filter":
          void this.view?.webview.postMessage({
            type: "workspace/filterMatches",
            query: message.query,
            uris: matchingNoteUris(this.index.snapshot.notes, message.query, FILTER_MATCH_LIMIT),
          } satisfies HostToWorkspaceMessage);
          break;
        case "workspace/openNote":
          if (this.index.snapshot.notes.some((note) => note.uri === message.uri)) {
            await this.actions.openNote(message.uri);
          }
          break;
        case "workspace/openView":
          this.openView(message.id);
          break;
        case "workspace/openTag":
          /*
           * A tag is a collection, so it opens the list every other collection here opens.
           * It used to run the workspace search pre-filled with the tag, which is a dropdown
           * over the palette mixing notes, tasks and text matches together.
           */
          this.actions.openNotesList({ kind: "tag", tag: message.tag });
          break;
        case "workspace/revealTask":
          // Checked against the index first, as every other URI-bearing handler is.
          if (this.index.snapshot.tasks.some(
            (task) => task.noteUri === message.noteUri && task.range.start === message.start,
          )) {
            await this.actions.revealTask(message.noteUri, message.start);
          }
          break;
        case "workspace/toggleTask":
          try {
            await this.actions.toggleTask(
              message.noteUri,
              message.start,
              message.taskId,
              message.completed,
              message.version,
            );
          } finally {
            // The panel drew the box in the state the user clicked; redraw from the index.
            this.publish();
          }
          break;
        case "workspace/runCommand":
          await vscode.commands.executeCommand(MENU_COMMANDS[message.command]);
          break;
        case "workspace/noteAction":
          if (this.index.snapshot.notes.some((note) => note.uri === message.uri)) {
            await vscode.commands.executeCommand(
              NOTE_ACTION_COMMANDS[message.action],
              vscode.Uri.parse(message.uri),
            );
          }
          break;
      }
    } catch (error) {
      void this.view?.webview.postMessage({
        type: "workspace/error",
        message: error instanceof Error ? error.message : String(error),
      } satisfies HostToWorkspaceMessage);
      this.publish();
    }
  }

  private openView(id: WorkspaceViewRow["id"]): void {
    switch (id) {
      case "due":
        this.actions.openTasks("today");
        break;
      case "tasks":
        this.actions.openTasks("all");
        break;
      case "graph":
        this.actions.openGraph();
        break;
      case "broken":
        this.actions.openNotesList({ kind: "broken" });
        break;
      case "orphans":
        this.actions.openNotesList({ kind: "orphans" });
        break;
    }
  }

  /** The state the panel would render right now. Used by the design-conformance suite. */
  public stateForTests(): WorkspacePanelState {
    return this.buildState();
  }

  private publish(): void {
    const view = this.view;
    if (view === undefined) return;
    /*
     * The view is retained when hidden, so it stays addressable while the side bar shows some
     * other container. Publishing to it then costs a full state build and a structured clone
     * that nobody sees; the pending flag redraws it when it comes back.
     */
    if (!view.visible) {
      this.publishPending = true;
      return;
    }
    this.publishPending = false;
    void view.webview.postMessage({
      type: "workspace/state",
      state: this.buildState(),
    } satisfies HostToWorkspaceMessage);
  }

  private buildState(): WorkspacePanelState {
    return {
      ...this.derivedState(),
      // The things that move without the index moving.
      density: densitySetting(),
      status: this.index.status,
      /*
       * Read from the window rather than the index, because the index cannot tell the two
       * empty cases apart: no folder open and a folder holding no Markdown both arrive as
       * zero notes, and only one of them is answered by writing a note.
       */
      hasWorkspaceFolder: (vscode.workspace.workspaceFolders?.length ?? 0) > 0,
      ...(this.activeNoteUri === undefined ? {} : { activeNoteUri: this.activeNoteUri }),
    };
  }

  private derivedState(): DerivedPanelState {
    const snapshot = this.index.snapshot;
    const today = todayStamp();
    const key = `${snapshot.version}:${today}`;
    if (this.derived?.key === key) {
      return this.derived.state;
    }
    const state = this.deriveFromSnapshot(snapshot, today);
    this.derived = { key, state };
    return state;
  }

  private deriveFromSnapshot(snapshot: IndexSnapshot, today: string): DerivedPanelState {
    const links = noteLinkCounts(snapshot);
    const due = selectDueTasks(snapshot, today, DUE_ROW_LIMIT);

    return {
      views: SMART_VIEWS.map((view) => this.viewRow(view, snapshot, due)),
      dueToday: due.rows.map((task): WorkspaceTaskRow => ({
        noteUri: task.noteUri,
        noteTitle: task.noteTitle,
        start: task.range.start,
        ...(task.id === undefined ? {} : { id: task.id }),
        text: task.text,
        completed: task.completed,
        ...(task.due === undefined ? {} : { due: task.due }),
        ...(task.priority === undefined ? {} : { priority: task.priority }),
      })),
      folders: folderRows(snapshot),
      notes: snapshot.notes.map((note): WorkspaceNoteRow => ({
        uri: note.uri,
        title: note.title,
        path: note.path,
        folder: note.path.split("/").slice(0, -1).join("/"),
        links: links.get(note.uri) ?? 0,
      })),
      tags: tagRows(snapshot),
      noteCount: snapshot.notes.length,
      taskCount: snapshot.tasks.length,
      skippedOversized: snapshot.skippedOversized,
      indexedAt: snapshot.indexedAt,
      version: snapshot.version,
    };
  }

  /**
   * A view carries its own colour only when it is asking for something: work due today, or a
   * link that no longer lands. An empty one stays with the rest of the panel.
   */
  private viewRow(
    view: (typeof SMART_VIEWS)[number],
    snapshot: IndexSnapshot,
    due: DueSelection,
  ): WorkspaceViewRow {
    switch (view.id) {
      case "due":
        return {
          ...view,
          count: due.total,
          // Late work is the one thing here that has already gone wrong, so it warns.
          tone: due.overdue > 0 ? "warning" : due.total > 0 ? "brand" : "default",
        };
      case "tasks":
        return { ...view, count: snapshot.tasks.length, tone: "default" };
      case "broken": {
        const broken = getBrokenLinks(snapshot).length;
        return { ...view, count: broken, tone: broken > 0 ? "warning" : "default" };
      }
      case "orphans":
        return { ...view, count: getOrphanNotes(snapshot).length, tone: "default" };
      case "graph":
        return { ...view, tone: "default" };
    }
  }
}

/** The part of the panel's state that is a pure function of the index snapshot. */
type DerivedPanelState =
  Omit<WorkspacePanelState, "density" | "status" | "activeNoteUri" | "hasWorkspaceFolder">;

/** How tall the panel's rows are. The prototype exposes this as a two-step control. */
function densitySetting(): WorkspaceDensity {
  return vscode.workspace.getConfiguration().get<string>("vispNotes.density") === "compact"
    ? "compact"
    : "comfortable";
}

/** Top-level folders and how many notes each holds, including nested ones. */
function folderRows(snapshot: IndexSnapshot): readonly WorkspaceFolderRow[] {
  const counts = new Map<string, number>();
  for (const note of snapshot.notes) {
    const segments = note.path.split("/").slice(0, -1);
    if (segments.length === 0) continue;
    const top = segments[0] ?? "";
    counts.set(top, (counts.get(top) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right, undefined, { sensitivity: "base" }))
    .map(([path, count]) => ({ path, label: path, count }));
}

function tagRows(snapshot: IndexSnapshot): readonly { name: string; count: number }[] {
  const counts = new Map<string, { name: string; count: number }>();
  for (const note of snapshot.notes) {
    for (const tag of note.tags) {
      const key = tag.toLocaleLowerCase();
      const current = counts.get(key);
      counts.set(key, { name: current?.name ?? tag, count: (current?.count ?? 0) + 1 });
    }
  }
  return [...counts.values()].sort((left, right) =>
    right.count - left.count ||
    left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));
}
