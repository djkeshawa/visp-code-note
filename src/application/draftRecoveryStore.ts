const STORAGE_KEY = "vispNotes.noteDraftRecoveries.v1";
const SCHEMA_VERSION = 1;
const MAX_SOURCE_LENGTH = 10_000_000;

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

interface StoredEnvelope {
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly entries: readonly StoredDraft[];
}

export class DraftRecoveryStore {
  private readonly drafts: Map<string, RecoverableDraft>;
  private pendingWrite = Promise.resolve();
  private writeFailed = false;

  public constructor(
    private readonly state?: KeyValueState,
    private readonly onPersistenceError: (error: unknown) => void = () => undefined,
  ) {
    this.drafts = decodeEnvelope(state?.get<unknown>(STORAGE_KEY));
  }

  public get(uri: string): RecoverableDraft | undefined {
    return this.drafts.get(uri);
  }

  public set(uri: string, draft: RecoverableDraft): void {
    this.drafts.set(uri, Object.freeze({ ...draft }));
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
        ...draft,
        updatedAt: Date.now(),
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

function decodeEnvelope(value: unknown): Map<string, RecoverableDraft> {
  const drafts = new Map<string, RecoverableDraft>();
  if (!isRecord(value) || value.schemaVersion !== SCHEMA_VERSION || !Array.isArray(value.entries)) {
    return drafts;
  }
  for (const entry of value.entries) {
    if (!isStoredDraft(entry)) continue;
    drafts.set(entry.uri, Object.freeze({
      source: entry.source,
      saveRequested: entry.saveRequested,
    }));
  }
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
