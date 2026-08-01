import * as vscode from "vscode";
import type { IndexSnapshot } from "../../domain/models";
import { MAX_LEAD_MINUTES, formatDueMoment, parseTimeOfDay } from "../../application/dueDate";
import type { ReminderCandidate, ReminderSettings } from "../../application/reminderSchedule";
import {
  ReminderRunner,
  type ReminderAction,
  type ReminderClock,
} from "../../application/reminderRunner";
import type { ReminderStore } from "../../application/reminderStore";

/**
 * Telling the reader a task is due.
 *
 * An extension cannot raise an OS notification — `showInformationMessage` is the whole of what
 * VS Code offers — so a reminder is a toast inside the window, and only appears while the
 * window is open. Reminders that came due while it was closed are shown once, bounded by
 * `catchUpWindowHours`, because a workspace reopened after a fortnight holds a fortnight of
 * them and none is news.
 *
 * All the deciding lives in `ReminderRunner`, which knows nothing of VS Code and can therefore
 * be driven through a whole afternoon by a test. This class is the wiring: the settings, the
 * clock, the notifications, and what their buttons do.
 */

const OPEN_NOTE = "Open Note";
const SNOOZE = "Snooze 10m";
const MARK_DONE = "Mark Done";
const OPEN_TASKS = "Open Tasks";

export interface ReminderActions {
  readonly revealTask: (noteUri: string, start: number) => Promise<void>;
  readonly toggleTask: (
    noteUri: string,
    start: number,
    taskId: string | undefined,
    completed: boolean,
    version: number,
  ) => Promise<void>;
  readonly openTasks: (filter: "all" | "today") => void;
}

export interface ReminderIndex {
  readonly snapshot: IndexSnapshot;
  onDidChange(listener: () => void): vscode.Disposable;
}

export class ReminderScheduler implements vscode.Disposable {
  private readonly runner: ReminderRunner;
  private readonly subscriptions: vscode.Disposable[];

  public constructor(
    index: ReminderIndex,
    store: ReminderStore,
    actions: ReminderActions,
    output: vscode.LogOutputChannel,
    clock: ReminderClock = systemClock,
  ) {
    this.runner = new ReminderRunner({
      snapshot: () => index.snapshot,
      settings,
      delivered: store,
      clock,
      presenter: {
        one: (candidate) => showReminder(candidate),
        group: async (count) =>
          await vscode.window.showInformationMessage(
            `${count} Visp Notes tasks are due.`,
            OPEN_TASKS,
          ) === OPEN_TASKS,
      },
      outcomes: {
        open: (candidate) => actions.revealTask(candidate.noteUri, candidate.start),
        done: (candidate) => actions.toggleTask(
          candidate.noteUri,
          candidate.start,
          candidate.id,
          candidate.completed,
          index.snapshot.version,
        ),
        openTasks: () => actions.openTasks("all"),
        report: (error) => output.error(`Reminder action failed: ${String(error)}`),
      },
    });

    this.subscriptions = [
      index.onDidChange(() => this.runner.settle()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("vispNotes.reminders")) this.runner.settle();
      }),
    ];
  }

  /** Shows anything already due and arms the first timer. */
  public start(): void {
    this.runner.look();
  }

  public dispose(): void {
    this.runner.dispose();
    vscode.Disposable.from(...this.subscriptions).dispose();
  }
}

const systemClock: ReminderClock = {
  now: () => Date.now(),
  schedule: (callback, delayMs) => {
    const timer = setTimeout(callback, delayMs);
    return () => clearTimeout(timer);
  },
};

async function showReminder(candidate: ReminderCandidate): Promise<ReminderAction | undefined> {
  const when = formatDueMoment(candidate.due, candidate.dueAt);
  /*
   * The note's title rides in the message rather than in `MessageOptions.detail`, which VS Code
   * renders only for modal dialogs and drops silently from a toast.
   */
  const choice = await vscode.window.showInformationMessage(
    `${candidate.text} — due ${when} · ${candidate.noteTitle}`,
    OPEN_NOTE,
    SNOOZE,
    MARK_DONE,
  );
  if (choice === OPEN_NOTE) return "open";
  if (choice === SNOOZE) return "snooze";
  if (choice === MARK_DONE) return "done";
  return undefined;
}

/**
 * The settings, clamped to the ranges package.json declares.
 *
 * Clamped here because VS Code does not enforce a schema's `maximum` on a hand-edited
 * settings.json — `get` returns the raw value. An unbounded lead pushed every reminder moment
 * into the deep past, where it aged out of the catch-up window: reminders off, and nothing
 * anywhere saying why.
 */
function settings(): ReminderSettings {
  const config = vscode.workspace.getConfiguration("vispNotes.reminders");
  return {
    enabled: config.get<boolean>("enabled", true),
    defaultMinutes: parseTimeOfDay(config.get<string>("defaultTime", "09:00")),
    defaultLeadMinutes: clamp(config.get<number>("leadMinutes", 0), MAX_LEAD_MINUTES),
    catchUpWindowMs: clamp(config.get<number>("catchUpWindowHours", 24), 336) * 3_600_000,
  };
}

function clamp(value: number, most: number): number {
  return Number.isFinite(value) ? Math.min(Math.max(0, value), most) : 0;
}
