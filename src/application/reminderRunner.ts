import type { IndexSnapshot } from "../domain/models";
import {
  decideReminders,
  reminderCandidates,
  type ReminderCandidate,
  type ReminderSettings,
} from "./reminderSchedule";

/**
 * The whole of what a reminder does, with nothing of VS Code in it.
 *
 * Everything here used to live in the provider, where it could only be exercised by hand: the
 * timer, the settling, the snooze bookkeeping and the decision about what has already been
 * shown. Two of the worst bugs in this feature — a notification that repeated per keystroke,
 * and a gate that silently switched every later reminder off — were behaviours of that loop
 * rather than of the pure decision underneath it, and neither could be written down as a test.
 *
 * The clock and the notifications are ports, so a test can drive a whole afternoon of them in
 * a millisecond.
 */

export type ReminderAction = "open" | "snooze" | "done";

/** Time, as the runner is allowed to know it. */
export interface ReminderClock {
  now(): number;
  /** Runs `callback` after `delayMs`; the returned function cancels it. */
  schedule(callback: () => void, delayMs: number): () => void;
}

/** Raising the notifications, and hearing what came back. */
export interface ReminderPresenter {
  one(candidate: ReminderCandidate): Promise<ReminderAction | undefined>;
  /** Used when so many fall due at once that they stop being individual interruptions. */
  group(count: number): Promise<boolean>;
}

/** What the runner does once the reader has answered. */
export interface ReminderOutcomes {
  open(candidate: ReminderCandidate): Promise<void>;
  done(candidate: ReminderCandidate): Promise<void>;
  openTasks(): void;
  report(error: unknown): void;
}

export interface ReminderDelivered {
  has(key: string): boolean;
  markDelivered(keys: readonly string[], now?: number): void;
  forget(key: string): void;
}

export interface ReminderRunnerPorts {
  readonly snapshot: () => IndexSnapshot;
  readonly settings: () => ReminderSettings;
  readonly delivered: ReminderDelivered;
  readonly clock: ReminderClock;
  readonly presenter: ReminderPresenter;
  readonly outcomes: ReminderOutcomes;
}

/** Never wait longer than this, so a suspended laptop or a corrected clock self-corrects. */
const MAX_DELAY_MS = 15 * 60_000;
const MIN_DELAY_MS = 250;
/** How long to let the index settle before looking again, so typing does not drive the loop. */
export const SETTLE_MS = 600;
export const SNOOZE_MS = 10 * 60_000;
/** Beyond this many at once, they stop being individual interruptions and become a list. */
export const GROUPED_THRESHOLD = 4;

export class ReminderRunner {
  private cancelTimer: (() => void) | undefined;
  private cancelSettle: (() => void) | undefined;
  private disposed = false;
  /** Reminders put off by hand, and until when. Not persisted: a snooze is about ten minutes. */
  private readonly snoozed = new Map<string, number>();

  public constructor(private readonly ports: ReminderRunnerPorts) {}

  /** Looks now. Anything the index has moved is routed through `settle` instead. */
  public look(): void {
    if (this.disposed) return;
    this.clearTimer();

    const settings = this.ports.settings();
    if (!settings.enabled) return;

    const now = this.ports.clock.now();
    const decision = decideReminders(
      this.candidates(settings),
      now,
      (key) => this.ports.delivered.has(key),
      settings,
    );

    if (decision.deliver.length > 0) {
      /*
       * Marked before showing, not after. A notification carrying buttons has no timeout, so it
       * is answered whenever the reader gets to it, and the index moves freely in between —
       * marking afterwards showed the same reminder over and over in the meantime.
       */
      this.ports.delivered.markDelivered(decision.deliver.map((entry) => entry.key), now);
      for (const candidate of decision.deliver) this.snoozed.delete(candidate.key);
      this.show(decision.deliver);
    }

    if (decision.nextAt === undefined) return;
    this.cancelTimer = this.ports.clock.schedule(
      () => {
        this.cancelTimer = undefined;
        this.look();
      },
      Math.max(MIN_DELAY_MS, Math.min(decision.nextAt - now, MAX_DELAY_MS)),
    );
  }

  /**
   * Looks once the index has stopped moving.
   *
   * Typing republishes the index on almost every keystroke; nothing about a reminder changes
   * within half a second of the last edit, so the work waits for the reader to stop.
   */
  public settle(): void {
    if (this.disposed || this.cancelSettle !== undefined) return;
    this.cancelSettle = this.ports.clock.schedule(() => {
      this.cancelSettle = undefined;
      this.look();
    }, SETTLE_MS);
  }

  public dispose(): void {
    this.disposed = true;
    this.clearTimer();
    this.cancelSettle?.();
    this.cancelSettle = undefined;
  }

  /** How long until the runner next intends to wake. Used by the tests. */
  public get snoozeCount(): number {
    return this.snoozed.size;
  }

  private candidates(settings: ReminderSettings): readonly ReminderCandidate[] {
    const live = reminderCandidates(this.ports.snapshot(), settings);
    // A snooze belongs to a reminder that still exists; moving a due date retires the old one.
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

  /**
   * Each notification is launched and left to itself rather than awaited in turn, because one
   * left sitting in the notification centre must not hold up the rest.
   */
  private show(due: readonly ReminderCandidate[]): void {
    if (due.length >= GROUPED_THRESHOLD) {
      void this.ports.presenter.group(due.length)
        .then((open) => {
          if (open) this.ports.outcomes.openTasks();
        })
        .catch((error: unknown) => this.ports.outcomes.report(error));
      return;
    }
    for (const candidate of due) void this.showOne(candidate);
  }

  private async showOne(candidate: ReminderCandidate): Promise<void> {
    try {
      const action = await this.ports.presenter.one(candidate);
      if (action === undefined || this.disposed) return;
      if (action === "open") {
        await this.ports.outcomes.open(this.current(candidate));
      } else if (action === "done") {
        await this.ports.outcomes.done(this.current(candidate));
      } else {
        this.snoozed.set(candidate.key, this.ports.clock.now() + SNOOZE_MS);
        this.ports.delivered.forget(candidate.key);
        this.look();
      }
    } catch (error) {
      this.ports.outcomes.report(error);
    }
  }

  /**
   * The reminder as the index holds it now.
   *
   * A notification can sit unanswered for hours while the note it belongs to is edited, so the
   * offset it was built with is not to be trusted by the time anybody clicks.
   */
  private current(candidate: ReminderCandidate): ReminderCandidate {
    return reminderCandidates(this.ports.snapshot(), this.ports.settings())
      .find((entry) => entry.key === candidate.key) ?? candidate;
  }

  private clearTimer(): void {
    this.cancelTimer?.();
    this.cancelTimer = undefined;
  }
}
