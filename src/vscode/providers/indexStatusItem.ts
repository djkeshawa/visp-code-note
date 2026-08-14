import * as vscode from "vscode";
import type { SkippedNote } from "../../domain/models";
import type { WorkspaceIndex } from "../../indexing/workspaceIndex";
import { oversizedReason, oversizedTally } from "../../application/oversizedNotes";
import { COMMAND_IDS } from "../ids";

/**
 * How long the index has to stay busy before the status bar says so.
 *
 * Typing in a note re-indexes that one file, which completes in a few milliseconds. Showing
 * the spinner for each of those made the item flicker several times a second and shove every
 * status entry to its left about as often. Only work that outlasts this is worth reporting,
 * and a real rebuild outlasts it comfortably.
 */
const BUSY_ANNOUNCE_DELAY_MS = 400;

/**
 * How many skipped files the tooltip names before it stops counting them out.
 *
 * A vault that has just been cloned can hit the ceiling with a whole directory of generated
 * Markdown, and a tooltip listing four hundred paths is a tooltip nobody can read past. The
 * first few are what tells the reader whether this is the note they were looking for.
 */
const NAMED_SKIPS = 5;

function skippedTooltipLines(skipped: readonly SkippedNote[]): readonly string[] {
  const reason = oversizedReason(skipped);
  if (reason === undefined) return [];
  const remaining = skipped.length - NAMED_SKIPS;
  return [
    reason,
    [
      ...skipped.slice(0, NAMED_SKIPS).map((entry) => `\`${entry.path}\``),
      ...(remaining > 0 ? [`and ${remaining} more`] : []),
    ].join("\n\n"),
  ];
}

export interface IndexStatusPresentation {
  readonly text: string;
  readonly tooltip: string | vscode.MarkdownString;
  /** Whether the item should carry the error background. */
  readonly errored: boolean;
}

/**
 * What the index holds, in the status bar.
 *
 * The workspace panel says the same thing in its footer, but the panel is one of several that
 * share the side bar and is often not the one showing. This is the one place the state of the
 * index is always visible — and the place a failed index can say so without opening a
 * notification the user has to dismiss.
 */
export class IndexStatusItem implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private readonly subscriptions: vscode.Disposable[];
  private busyTimer: ReturnType<typeof setTimeout> | undefined;
  private announcingBusy = false;

  public constructor(private readonly index: WorkspaceIndex) {
    this.item = vscode.window.createStatusBarItem(
      "vispNotes.indexStatus",
      /*
       * The left cluster, as the design places it: after the branch and the problem counts,
       * which are what the workspace's own state is read alongside. A low priority is what
       * puts it to their right rather than ahead of them.
       */
      vscode.StatusBarAlignment.Left,
      0,
    );
    this.item.name = "Visp Notes index";
    this.item.command = COMMAND_IDS.search;
    // The prototype gives this entry the identity hue rather than the status bar's own.
    this.item.color = new vscode.ThemeColor("vispNotes.hueStructure");
    this.subscriptions = [
      index.onDidChange(() => this.update()),
      index.onDidChangeStatus(() => this.update()),
    ];
    this.update();
    this.item.show();
  }

  /**
   * What the item displays for the index as it stands. Separated from the writing of it so a
   * test can check the words without waiting on the debounce or reading the status bar, which
   * VS Code offers no way to query.
   */
  public get presentation(): IndexStatusPresentation {
    if (this.index.status === "indexing") {
      return {
        text: "$(sync~spin) Indexing notes",
        tooltip: "Visp Notes is reading the workspace's Markdown.",
        errored: false,
      };
    }
    if (this.index.status === "error") {
      return {
        text: "$(error) Index needs attention",
        tooltip: this.index.lastError
          ?? "Visp Notes could not build its index. Try Rebuild Index.",
        errored: true,
      };
    }
    const { notes, tasks, skippedOversized } = this.index.snapshot;
    const openTasks = tasks.filter((task) => !task.completed).length;
    /*
     * The same figures the workspace panel's footer prints, so the two cannot appear to
     * contradict each other. How many of those tasks are still open is in the tooltip: it is a
     * different question, and answering it here in the same words as the footer answers a
     * different one was simply confusing.
     *
     * The skipped tally joins the text rather than staying in the tooltip, because a note count
     * that silently disagrees with the number of `.md` files in the workspace is the whole
     * complaint. The tooltip is where the reason and the file names go — a status bar entry has
     * no room to name a path, and a reader who has noticed the tally is already hovering.
     */
    const skippedCount = skippedOversized.length;
    return {
      text: `$(database) ${notes.length} note${notes.length === 1 ? "" : "s"} · ${
        tasks.length
      } task${tasks.length === 1 ? "" : "s"}${
        skippedCount === 0 ? "" : ` · ${oversizedTally(skippedCount)}`
      }`,
      tooltip: new vscode.MarkdownString(
        [
          `**${notes.length}** indexed note${notes.length === 1 ? "" : "s"}`,
          `**${openTasks}** of ${tasks.length} task${tasks.length === 1 ? "" : "s"} still open`,
          ...skippedTooltipLines(skippedOversized),
          "",
          "Select to search notes and tasks.",
        ].join("\n\n"),
      ),
      errored: false,
    };
  }

  public dispose(): void {
    this.clearBusyTimer();
    vscode.Disposable.from(...this.subscriptions).dispose();
    this.item.dispose();
  }

  private update(): void {
    if (this.index.status === "indexing") {
      // Announced only if it lasts; a one-file re-read on a keystroke never reaches this.
      if (!this.announcingBusy && this.busyTimer === undefined) {
        this.busyTimer = setTimeout(() => {
          this.busyTimer = undefined;
          this.announcingBusy = true;
          this.apply();
        }, BUSY_ANNOUNCE_DELAY_MS);
      }
      return;
    }
    this.clearBusyTimer();
    this.announcingBusy = false;
    this.apply();
  }

  private apply(): void {
    const presentation = this.presentation;
    this.item.text = presentation.text;
    this.item.tooltip = presentation.tooltip;
    this.item.backgroundColor = presentation.errored
      ? new vscode.ThemeColor("statusBarItem.errorBackground")
      : undefined;
  }

  private clearBusyTimer(): void {
    if (this.busyTimer !== undefined) {
      clearTimeout(this.busyTimer);
      this.busyTimer = undefined;
    }
  }
}
