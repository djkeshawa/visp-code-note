import type { KeyValueState } from "./draftRecoveryStore";

/**
 * Which reminders have already been shown.
 *
 * Without this a reminder repeats on every index change — which on a workspace being edited is
 * every few seconds — and again on every window reload. The key folds in the task's due and
 * lead (see `reminderKey`), so moving a due date re-arms the reminder rather than being
 * remembered as already handled.
 *
 * Shaped like `DraftRecoveryStore`: the same workspace-state envelope, the same debounced
 * write, and the same two budgets, because the failure mode is the same one — a workspace
 * edited over months accumulating entries VS Code then loads on every activation.
 */

const STORAGE_KEY = "vispNotes.deliveredReminders.v1";
const SCHEMA_VERSION = 1;

const MAX_ENTRIES = 500;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_KEY_LENGTH = 4_096;

interface StoredReminder {
  readonly key: string;
  readonly deliveredAt: number;
}

interface StoredEnvelope {
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly entries: readonly StoredReminder[];
}

export class ReminderStore {
  private readonly delivered: Map<string, number>;
  private pendingWrite = Promise.resolve();
  private writeFailed = false;

  public constructor(
    private readonly state?: KeyValueState,
    private readonly onPersistenceError: (error: unknown) => void = () => undefined,
  ) {
    this.delivered = decodeEnvelope(state?.get<unknown>(STORAGE_KEY), Date.now());
  }

  public has(key: string): boolean {
    return this.delivered.has(key);
  }

  /** Records one or more reminders as handled, whether they were shown or silently dropped. */
  public markDelivered(keys: readonly string[], now = Date.now()): void {
    let changed = false;
    for (const key of keys) {
      if (key.length > MAX_KEY_LENGTH || this.delivered.has(key)) continue;
      this.delivered.set(key, now);
      changed = true;
    }
    if (!changed) return;
    evictBeyondBudget(this.delivered, now);
    this.scheduleWrite();
  }

  /**
   * Un-records a reminder, so it can fire again.
   *
   * Snoozing needs this. A toast is marked delivered the moment it is shown — otherwise the
   * next index change shows it again — so putting one off has to undo that.
   */
  public forget(key: string): void {
    if (!this.delivered.delete(key)) return;
    this.scheduleWrite();
  }

  /**
   * Waits the writes out, retrying a failed one once.
   *
   * Same shape as `DraftRecoveryStore.flush`, for the same reason: this runs at deactivation,
   * which is the last chance the envelope gets. Losing it re-shows every reminder answered
   * since the previous successful write.
   */
  public async flush(): Promise<void> {
    let retried = false;
    while (true) {
      const pending = this.pendingWrite;
      await pending;
      if (pending !== this.pendingWrite) continue;
      if (this.writeFailed && !retried) {
        retried = true;
        this.scheduleWrite();
        continue;
      }
      return;
    }
  }

  private scheduleWrite(): void {
    if (this.state === undefined) return;
    const envelope: StoredEnvelope = {
      schemaVersion: SCHEMA_VERSION,
      entries: [...this.delivered].map(([key, deliveredAt]) => ({ key, deliveredAt })),
    };
    this.pendingWrite = this.pendingWrite
      .then(() => Promise.resolve(this.state?.update(STORAGE_KEY, envelope)))
      .then(() => {
        this.writeFailed = false;
      })
      .catch((error: unknown) => {
        this.writeFailed = true;
        try {
          this.onPersistenceError(error);
        } catch {
          // A failed write must not poison the next one.
        }
      });
  }
}

/**
 * Drops the oldest entries until the retained set is inside both budgets.
 *
 * Age first: a reminder delivered a month ago is for a task that has since been done, moved or
 * abandoned, and if it somehow has not been, showing it again is the right thing anyway.
 */
function evictBeyondBudget(delivered: Map<string, number>, now: number): void {
  for (const [key, deliveredAt] of delivered) {
    if (now - deliveredAt > MAX_AGE_MS) delivered.delete(key);
  }
  for (const key of [...delivered.keys()]) {
    if (delivered.size <= MAX_ENTRIES) break;
    delivered.delete(key);
  }
}

function decodeEnvelope(value: unknown, now: number): Map<string, number> {
  const delivered = new Map<string, number>();
  if (!isRecord(value) || value.schemaVersion !== SCHEMA_VERSION || !Array.isArray(value.entries)) {
    return delivered;
  }
  const retained = value.entries
    .filter(isStoredReminder)
    .sort((left, right) => left.deliveredAt - right.deliveredAt);
  for (const entry of retained) delivered.set(entry.key, entry.deliveredAt);
  evictBeyondBudget(delivered, now);
  return delivered;
}

function isStoredReminder(value: unknown): value is StoredReminder {
  return isRecord(value) &&
    typeof value.key === "string" && value.key.length > 0 && value.key.length <= MAX_KEY_LENGTH &&
    typeof value.deliveredAt === "number" && Number.isFinite(value.deliveredAt);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
