import type { KeyValueState } from "./draftRecoveryStore";

/**
 * The words the reader has told the spell checker to accept.
 *
 * Held in global rather than workspace state on purpose: a word you accept is a fact about
 * your own vocabulary, not about a repository. Having to accept your surname, or the name of
 * the tool you use every day, once per workspace would be tedious enough that nobody would
 * bother — and there is no harm in a word you have already vouched for being known elsewhere.
 *
 * Shaped like `ReminderStore`: the same envelope, the same debounced write and the same
 * refusal to grow without bound, because the failure mode is the same one — something written
 * to for months and then loaded on every activation.
 */

const STORAGE_KEY = "vispNotes.personalDictionary.v1";
const SCHEMA_VERSION = 1;

/** Well past any real vocabulary, and small enough to stay cheap to load and to search. */
const MAX_WORDS = 5_000;
/** Longer than any word; a token past this is a paste, not something to remember. */
const MAX_WORD_LENGTH = 64;

interface StoredEnvelope {
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly words: readonly string[];
}

export class PersonalDictionaryStore {
  private readonly accepted: Set<string>;
  private pendingWrite = Promise.resolve();

  public constructor(
    private readonly state?: KeyValueState,
    private readonly onPersistenceError: (error: unknown) => void = () => undefined,
  ) {
    this.accepted = decodeEnvelope(state?.get<unknown>(STORAGE_KEY));
  }

  public get words(): readonly string[] {
    return [...this.accepted];
  }

  /**
   * Remembers a word, and says whether anything changed — a word already accepted is not
   * worth a write.
   */
  public add(word: string): boolean {
    const normalized = normalize(word);
    if (normalized === undefined || this.accepted.has(normalized)) return false;
    this.accepted.add(normalized);
    /*
     * Oldest first, which for a dictionary means the words accepted longest ago. Insertion
     * order is the only ordering there is, and the alternative — refusing new words once full
     * — would silently stop the feature working with no way to tell.
     */
    while (this.accepted.size > MAX_WORDS) {
      const oldest = this.accepted.values().next().value;
      if (oldest === undefined) break;
      this.accepted.delete(oldest);
    }
    this.scheduleWrite();
    return true;
  }

  /** Waits out the pending write, so a word accepted just before shutdown is not lost. */
  public async flush(): Promise<void> {
    await this.pendingWrite;
  }

  private scheduleWrite(): void {
    if (this.state === undefined) return;
    const envelope: StoredEnvelope = {
      schemaVersion: SCHEMA_VERSION,
      words: [...this.accepted],
    };
    this.pendingWrite = this.pendingWrite
      .then(() => Promise.resolve(this.state?.update(STORAGE_KEY, envelope)))
      .catch((error: unknown) => {
        try {
          this.onPersistenceError(error);
        } catch {
          // A failed write must not poison the next one.
        }
      });
  }
}

function normalize(word: string): string | undefined {
  const trimmed = word.trim().toLowerCase();
  if (trimmed.length === 0 || trimmed.length > MAX_WORD_LENGTH) return undefined;
  // A word is letters and the apostrophes inside a contraction, and nothing else.
  return /^[\p{L}][\p{L}'’]*$/u.test(trimmed) ? trimmed : undefined;
}

function decodeEnvelope(value: unknown): Set<string> {
  const accepted = new Set<string>();
  if (
    typeof value !== "object" || value === null ||
    (value as StoredEnvelope).schemaVersion !== SCHEMA_VERSION ||
    !Array.isArray((value as StoredEnvelope).words)
  ) {
    return accepted;
  }
  for (const word of (value as StoredEnvelope).words) {
    if (typeof word !== "string") continue;
    const normalized = normalize(word);
    if (normalized !== undefined) accepted.add(normalized);
    if (accepted.size >= MAX_WORDS) break;
  }
  return accepted;
}
