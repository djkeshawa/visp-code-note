import * as vscode from "vscode";
import type { IndexSnapshot } from "../../domain/models";
import { MAX_LEAD_MINUTES, formatDueMoment, parseTimeOfDay } from "../../application/dueDate";
import {
  decideReminders,
  reminderCandidates,
  type ReminderCandidate,
  type ReminderSettings,
} from "../../application/reminderSchedule";
import type { ReminderStore } from "../../application/reminderStore";

/**
 * Telling the reader a task is due.
 *
 * An extension cannot raise an OS notification — `showInformationMessage` is the whole of what
 * VS Code offers — so a reminder is a toast inside the window, and only appears while the
 * window is open. Reminders that came due while it was closed are caught up once, bounded by
 * `catchUpWindowHours`, because a workspace reopened after a fortnight holds a fortnight of
 * them and none is news.
 *
 * One timer serves the whole workspace. It is re-armed after every tick and never set further
 * out than `MAX_DELAY_MS`, so a laptop suspended over the due moment, a clock corrected, or a
 * DST boundary crossed all resolve themselves within a quarter hour instead of firing hours
 * late or not at all.
 */

const MAX_DELAY_MS = 15 * 60_000;
const MIN_DELAY_MS = 250;
/**
 * How long to let the index settle before looking again.
 *
 * Typing in a note republishes the index on almost every keystroke, and each republish used to
 * walk every task in the workspace and write to workspace state. Nothing about a reminder
 * changes within half a second of the last edit, so the work waits for the reader to stop.
 */
const SETTLE_MS = 600;
const SNOOZE_MS = 10 * 60_000;
/** Beyond this many at once, they stop being individual interruptions and become a list. */
const GROUPED_THRESHOLD = 4;

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
  private timer: ReturnType<typeof setTimeout> | undefined;
  private settleTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly subscriptions: vscode.Disposable[];
  /** Reminders put off by hand, and until when. Deliberately not persisted: a snooze is about
   * the next ten minutes, and a window reload has already interrupted the reader anyway. */
  private readonly snoozed = new Map<string, number>();
  private disposed = false;
  /**
   * When this scheduler started looking. Everything before it is history.
   *
   * Stamped at construction rather than in `start()`, because `start()` runs after the first
   * index build and does not run at all if that build fails — which used to leave the window
   * open at infinity and the catch-up rule switched on for the rest of the session.
   */
  private readonly watchSince = Date.now();
  /** History is delivered by the startup pass and never again. */
  private catchUp = true;

  public constructor(
    private readonly index: ReminderIndex,
    private readonly store: ReminderStore,
    private readonly actions: ReminderActions,
    private readonly output: vscode.LogOutputChannel,
  ) {
    this.subscriptions = [
      index.onDidChange(() => this.rescheduleWhenSettled()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("vispNotes.reminders")) this.rescheduleWhenSettled();
      }),
    ];
  }

  /** Runs the one catch-up pass and arms the first timer. */
  public start(): void {
    this.reschedule();
  }

  public dispose(): void {
    this.disposed = true;
    this.clearTimer();
    if (this.settleTimer !== undefined) clearTimeout(this.settleTimer);
    this.settleTimer = undefined;
    vscode.Disposable.from(...this.subscriptions).dispose();
  }

  private rescheduleWhenSettled(): void {
    if (this.disposed || this.settleTimer !== undefined) return;
    this.settleTimer = setTimeout(() => {
      this.settleTimer = undefined;
      this.reschedule();
    }, SETTLE_MS);
  }

  private reschedule(): void {
    if (this.disposed) return;
    this.clearTimer();
    /*
     * The catch-up pass is spent on the first look, whoever triggers it. `start()` used to be
     * the only place that retired the flag, and `start()` never runs when the initial index
     * build fails — which left catch-up switched on for the rest of the session, and with it
     * the very bug the watch window exists to stop: a due date typed in after the fact fired
     * a notification on the spot.
     */
    const catchUp = this.catchUp;
    this.catchUp = false;

    const config = settings();
    if (!config.enabled) return;

    const now = Date.now();
    const decision = decideReminders(
      this.candidates(config),
      now,
      (key) => this.store.has(key),
      config,
      { watchSince: this.watchSince, catchUp },
    );

    /*
     * Suppressions are not recorded. A moment older than `watchSince` can never be delivered
     * again this session — that is what the window means — so remembering it buys nothing, and
     * a workspace holding hundreds of past-dated tasks used to rewrite workspace state and log
     * a line on every index change, evicting genuinely delivered reminders to make room.
     */
    if (decision.suppress.length > 0 && catchUp) {
      this.output.info(
        `Skipped ${decision.suppress.length} reminder(s) older than the catch-up window.`,
      );
    }
    if (decision.deliver.length > 0) {
      // Marked before showing, not after. A notification is answered whenever the reader gets
      // to it, and the index moves freely in the meantime; marking afterwards showed the same
      // reminder over and over in between.
      this.store.markDelivered(decision.deliver.map((candidate) => candidate.key), now);
      for (const candidate of decision.deliver) this.snoozed.delete(candidate.key);
      this.show(decision.deliver);
    }

    if (decision.nextAt === undefined) return;
    this.armTimer(decision.nextAt - now);
  }

  private candidates(config: ReminderSettings): readonly ReminderCandidate[] {
    const live = reminderCandidates(this.index.snapshot, config);
    /*
     * A snooze belongs to a reminder that still exists. Moving the task's due date while it is
     * snoozed gives it a new identity, and the old entry would otherwise sit in this map for
     * the life of the window.
     */
    if (this.snoozed.size > 0) {
      const keys = new Set(live.map((candidate) => candidate.key));
      for (const key of [...this.snoozed.keys()]) {
        if (!keys.has(key)) this.snoozed.delete(key);
      }
    }
    return live.map((candidate) => {
      const until = this.snoozed.get(candidate.key);
      return until === undefined ? candidate : { ...candidate, at: until };
    });
  }

  private armTimer(delay: number): void {
    this.timer = setTimeout(
      () => {
        this.timer = undefined;
        this.reschedule();
      },
      Math.max(MIN_DELAY_MS, Math.min(delay, MAX_DELAY_MS)),
    );
  }

  private clearTimer(): void {
    if (this.timer === undefined) return;
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  /**
   * Raises the notifications.
   *
   * Each one is launched and left to itself rather than awaited in turn. A notification that
   * carries buttons does not time out — VS Code parks it in the notification centre until the
   * reader answers it — so awaiting one meant a second task due at the same moment never
   * appeared at all, and an earlier version gated the whole scheduler on that promise, which
   * silently switched reminders off for the rest of the session the first time one was ignored.
   */
  private show(due: readonly ReminderCandidate[]): void {
    if (due.length >= GROUPED_THRESHOLD) {
      void this.showGroup(due.length);
      return;
    }
    for (const candidate of due) void this.showOne(candidate);
  }

  private async showGroup(count: number): Promise<void> {
    const choice = await vscode.window.showInformationMessage(
      `${count} Visp Notes tasks are due.`,
      OPEN_TASKS,
    );
    if (choice === OPEN_TASKS) this.actions.openTasks("all");
  }

  private async showOne(candidate: ReminderCandidate): Promise<void> {
    const when = formatDueMoment(candidate.due, candidate.dueAt);
    /*
     * The note's title rides in the message rather than in `MessageOptions.detail`, which
     * VS Code renders only for modal dialogs and drops silently from a toast.
     */
    const choice = await vscode.window.showInformationMessage(
      `${candidate.text} — due ${when} · ${candidate.noteTitle}`,
      OPEN_NOTE,
      SNOOZE,
      MARK_DONE,
    );
    if (choice === undefined || this.disposed) return;
    try {
      await this.act(choice, candidate);
    } catch (error) {
      this.output.error(`Reminder action failed: ${String(error)}`);
    }
  }

  private async act(choice: string, candidate: ReminderCandidate): Promise<void> {
    /*
     * A notification can sit unanswered for hours while the note it belongs to is edited, so
     * the offset captured when the reminder was built is not to be trusted by the time anybody
     * clicks. The task is looked up again by the identity that does survive editing.
     */
    const current = this.currentCandidate(candidate.key) ?? candidate;
    if (choice === OPEN_NOTE) {
      await this.actions.revealTask(current.noteUri, current.start);
    } else if (choice === SNOOZE) {
      this.snoozed.set(candidate.key, Date.now() + SNOOZE_MS);
      this.store.forget(candidate.key);
      this.reschedule();
    } else if (choice === MARK_DONE) {
      await this.actions.toggleTask(
        current.noteUri,
        current.start,
        current.id,
        current.completed,
        this.index.snapshot.version,
      );
    }
  }

  /** The reminder as the index holds it now, when the task is still where it was. */
  private currentCandidate(key: string): ReminderCandidate | undefined {
    return reminderCandidates(this.index.snapshot, settings())
      .find((candidate) => candidate.key === key);
  }
}

/**
 * The settings, clamped to the ranges package.json declares.
 *
 * Clamped here because VS Code does not enforce a schema's `maximum` on a hand-edited
 * settings.json — `get` returns the raw value. An unbounded lead pushed every reminder moment
 * into the deep past, where the watch window silently suppressed it: reminders off, and
 * nothing anywhere saying why.
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
