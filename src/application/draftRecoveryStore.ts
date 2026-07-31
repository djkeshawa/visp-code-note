const STORAGE_KEY = "vispNotes.noteDraftRecoveries.v1";
const SCHEMA_VERSION = 1;
const MAX_SOURCE_LENGTH = 10_000_000;

/**
 * How much stranded draft text a workspace may carry, and for how long.
 *
 * An entry is written when a draft cannot be applied and removed as soon as it is recovered or
 * the document matches again, so the live set is however many notes are stranded right now —
 * a handful at the very worst. Nothing bounded it, though. A note the user never reopened kept
 * its entry for the life of the workspace, and each entry may hold ten megabytes of source, so
 * a workspace edited over months accumulated drafts that VS Code then loads on every
 * activation. The oldest go first: a draft nobody has come back for in a fortnight has been
 * abandoned or already rewritten by hand.
 */
const MAX_ENTRIES = 16;
const MAX_TOTAL_SOURCE_LENGTH = 8_000_000;
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export interface RecoverableDraft {
  readonly source: string;
  readonly saveRequested: boolean;
}

export interface KeyValueState {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void>;
}

interface StoredDraft extends RecoverableDraft {
  readonly uri: string;
  readonly updatedAt: number;
}

/** A draft held in memory, carrying when it was stranded so the oldest can be dropped first. */
interface RetainedDraft extends RecoverableDraft {
  readonly updatedAt: number;
}

interface StoredEnvelope {
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly entries: readonly StoredDraft[];
}

export class DraftRecoveryStore {
  private readonly drafts: Map<string, RetainedDraft>;
  private pendingWrite = Promise.resolve();
  private writeFailed = false;

  public constructor(
    private readonly state?: KeyValueState,
    private readonly onPersistenceError: (error: unknown) => void = () => undefined,
  ) {
    this.drafts = decodeEnvelope(state?.get<unknown>(STORAGE_KEY), Date.now());
  }

  public get(uri: string): RecoverableDraft | undefined {
    const draft = this.drafts.get(uri);
    if (draft === undefined) return undefined;
    return { source: draft.source, saveRequested: draft.saveRequested };
  }

  public set(uri: string, draft: RecoverableDraft): void {
    const now = Date.now();
    // Re-inserting moves the entry to the back, so map order is least-recently-stranded first,
    // which is the order entries are dropped in.
    this.drafts.delete(uri);
    this.drafts.set(uri, Object.freeze({
      source: draft.source,
      saveRequested: draft.saveRequested,
      updatedAt: now,
    }));
    evictBeyondBudget(this.drafts, now);
    this.scheduleWrite();
  }

  public delete(uri: string): void {
    if (!this.drafts.delete(uri)) return;
    this.scheduleWrite();
  }

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
      entries: [...this.drafts].map(([uri, draft]) => ({
        uri,
        source: draft.source,
        saveRequested: draft.saveRequested,
        // The moment this draft was stranded, not the moment the envelope happens to be
        // written. Stamping the write time here instead aged every entry forward whenever any
        // other note was edited, so nothing ever grew old enough to be dropped.
        updatedAt: draft.updatedAt,
      })),
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
          // Persistence errors must not poison later recovery writes.
        }
      });
  }
}

/**
 * Drops the oldest entries until the retained set is inside both budgets.
 *
 * The newest is never dropped, even when it alone is over the size budget: it is the draft the
 * caller has just stranded, so it is the one the user is most likely to still want back.
 */
function evictBeyondBudget(drafts: Map<string, RetainedDraft>, now: number): void {
  for (const [uri, draft] of drafts) {
    if (now - draft.updatedAt > MAX_AGE_MS) drafts.delete(uri);
  }

  let total = 0;
  for (const draft of drafts.values()) total += draft.source.length;

  for (const [uri, draft] of [...drafts]) {
    if (drafts.size <= 1) break;
    if (drafts.size <= MAX_ENTRIES && total <= MAX_TOTAL_SOURCE_LENGTH) break;
    drafts.delete(uri);
    total -= draft.source.length;
  }
}

function decodeEnvelope(value: unknown, now: number): Map<string, RetainedDraft> {
  const drafts = new Map<string, RetainedDraft>();
  if (!isRecord(value) || value.schemaVersion !== SCHEMA_VERSION || !Array.isArray(value.entries)) {
    return drafts;
  }
  const retained = value.entries
    .filter(isStoredDraft)
    .sort((left, right) => left.updatedAt - right.updatedAt);
  for (const entry of retained) {
    drafts.set(entry.uri, Object.freeze({
      source: entry.source,
      saveRequested: entry.saveRequested,
      updatedAt: entry.updatedAt,
    }));
  }
  // A workspace last opened months ago should not pay for drafts it has already forgotten
  // about, and an envelope written by an older build may hold more than the budgets allow.
  evictBeyondBudget(drafts, now);
  return drafts;
}

function isStoredDraft(value: unknown): value is StoredDraft {
  return isRecord(value) &&
    typeof value.uri === "string" && value.uri.length > 0 &&
    typeof value.source === "string" && value.source.length <= MAX_SOURCE_LENGTH &&
    typeof value.saveRequested === "boolean" &&
    typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
