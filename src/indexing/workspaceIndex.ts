import * as vscode from "vscode";
import type { IndexSnapshot, NoteRecord } from "../domain/models";
import { buildSnapshot } from "./projections";
import {
  discoverMarkdownUris,
  isIndexableMarkdown,
  readNoteRecord,
  uriKey,
} from "./discovery";
import { freezeSnapshot } from "./immutable";
import { mapConcurrent } from "./concurrency";
import { createIndexWatchers } from "./watchers";
import type { MarkdownChange } from "./watchers";
import { noteResolverFor } from "./noteResolver";
import { createNoteProjector } from "./noteProjection";
import type { NoteProjector } from "./noteProjection";

export type IndexStatus = "idle" | "indexing" | "error";

/**
 * Turns off the per-note projection cache, rebuilding the whole projection on every commit.
 *
 * A cache whose invalidation is wrong shows no symptom except a link pointing at a note that
 * no longer answers to that name — nothing throws, nothing slows down. Anyone who suspects
 * they are looking at one can be asked to flip this and reload, which settles it in one
 * message rather than one release.
 */
const BYPASS_PROJECTION_CACHE_SETTING = "vispNotes.index.bypassProjectionCache";

type PendingChange = MarkdownChange;

const EMPTY_SNAPSHOT = freezeSnapshot({
  notes: [],
  links: [],
  backlinks: [],
  tasks: [],
  version: 0,
  indexedAt: 0,
});

export class WorkspaceIndex implements vscode.Disposable {
  private readonly notes = new Map<string, NoteRecord>();
  private readonly changeEmitter = new vscode.EventEmitter<IndexSnapshot>();
  private readonly statusEmitter = new vscode.EventEmitter<IndexStatus>();
  private readonly subscriptions: vscode.Disposable[] = [];
  private readonly pendingChanges = new Map<string, PendingChange>();
  private operationTail: Promise<void> = Promise.resolve();
  private initialization: Promise<void> | undefined;
  private drainQueued = false;
  private disposed = false;
  private currentSnapshot = EMPTY_SNAPSHOT;
  private currentStatus: IndexStatus = "idle";
  private errorMessage: string | undefined;
  private projector: NoteProjector = createProjector();

  readonly onDidChange = this.changeEmitter.event;
  readonly onDidChangeStatus = this.statusEmitter.event;

  get snapshot(): IndexSnapshot {
    return this.currentSnapshot;
  }

  get status(): IndexStatus {
    return this.currentStatus;
  }

  get lastError(): string | undefined {
    return this.errorMessage;
  }

  initialize(): Promise<void> {
    if (!this.initialization) {
      this.subscriptions.push(
        ...createIndexWatchers(
          (change) => this.queueChange(change),
          () => { void this.rebuild().catch(() => undefined); },
        ),
        /*
         * Reaching the bypass has to be one step, not "change this and restart VS Code", or
         * it is not a bisection tool. The projector is thrown away with everything it
         * remembered and the workspace is read again from the files.
         */
        vscode.workspace.onDidChangeConfiguration((event) => {
          if (event.affectsConfiguration(BYPASS_PROJECTION_CACHE_SETTING)) {
            this.projector = createProjector();
            void this.rebuild().catch(() => undefined);
          }
        }),
      );
      this.initialization = this.rebuild();
    }
    return this.initialization;
  }

  rebuild(): Promise<void> {
    return this.enqueueOperation(async () => {
      const uris = await discoverMarkdownUris();
      const records = await mapConcurrent(uris, 16, (uri) => this.readIfPresent(uri));
      const next = new Map<string, NoteRecord>();
      for (const record of records) {
        if (record) {
          next.set(record.uri, record);
        }
      }
      this.commit(next);
    });
  }

  refresh(uri: vscode.Uri): Promise<void> {
    return this.upsert(uri);
  }

  move(previousUri: vscode.Uri, nextUri: vscode.Uri): Promise<void> {
    return this.enqueueOperation(() => this.applyChanges([
      { kind: "remove", uri: previousUri },
      { kind: "upsert", uri: nextUri },
    ]));
  }

  upsert(uri: vscode.Uri): Promise<void> {
    return this.enqueueOperation(() => this.applyChanges([{ kind: "upsert", uri }]));
  }

  remove(uri: vscode.Uri): Promise<void> {
    return this.enqueueOperation(() => this.applyChanges([{ kind: "remove", uri }]));
  }

  findNote(uri: vscode.Uri | string): NoteRecord | undefined {
    return this.notes.get(uriKey(uri));
  }

  resolveTarget(sourceUri: vscode.Uri | string, target: string): NoteRecord | undefined {
    return noteResolverFor(this.currentSnapshot.notes).resolve(uriKey(sourceUri), target);
  }

  dispose(): void {
    this.disposed = true;
    this.pendingChanges.clear();
    vscode.Disposable.from(...this.subscriptions).dispose();
    this.changeEmitter.dispose();
    this.statusEmitter.dispose();
  }

  private queueChange(change: PendingChange): void {
    if (this.disposed) {
      return;
    }
    this.pendingChanges.set(uriKey(change.uri), change);
    this.schedulePendingDrain();
  }

  private schedulePendingDrain(): void {
    if (this.drainQueued) {
      return;
    }

    this.drainQueued = true;
    void this.enqueueOperation(async () => {
      const changes = [...this.pendingChanges.values()];
      this.pendingChanges.clear();
      await this.applyChanges(changes);
    })
      .catch(() => undefined)
      .finally(() => {
        this.drainQueued = false;
        if (this.pendingChanges.size > 0) {
          this.schedulePendingDrain();
        }
      });
  }

  private async applyChanges(changes: readonly PendingChange[]): Promise<void> {
    const next = new Map(this.notes);
    let changed = false;
    for (let index = 0; index < changes.length; index += 1) {
      const change = changes[index];
      if (change === undefined) continue;
      const key = uriKey(change.uri);
      if (change.kind === "remove" || !isIndexableMarkdown(change.uri)) {
        changed = next.delete(key) || changed;
        continue;
      }

      let record: NoteRecord | undefined;
      try {
        record = await this.readIfPresent(change.uri);
      } catch (error) {
        /*
         * One unreadable file used to cost the whole batch. A watcher burst is coalesced into a
         * single drain, `pendingChanges` is emptied before it starts, and the new map was only
         * committed after the last change — so a read that threw part-way discarded every change
         * beside it, including removals, which cannot fail. Nothing retried them, and the error
         * status was cleared by the next unrelated change, so a note deleted from disk stayed in
         * the index and a note already re-read stayed stale until a full rebuild.
         *
         * The work that succeeded is committed, the entries never attempted go back on the queue
         * for the reschedule to pick up, and only the one that failed is dropped — putting that
         * back would spin the drain against a file that keeps failing.
         */
        if (changed) this.commit(next);
        this.requeueUnattempted(changes.slice(index + 1));
        throw error;
      }
      if (record) {
        const current = next.get(key);
        if (
          !current ||
          current.content !== record.content ||
          current.path !== record.path ||
          current.modifiedAt !== record.modifiedAt
        ) {
          next.set(key, record);
          changed = true;
        }
      } else {
        changed = next.delete(key) || changed;
      }
    }
    if (changed) {
      this.commit(next);
    }
  }

  /** Returns changes a failed drain never reached, without displacing newer events for them. */
  private requeueUnattempted(changes: readonly PendingChange[]): void {
    if (this.disposed) return;
    for (const change of changes) {
      const key = uriKey(change.uri);
      if (!this.pendingChanges.has(key)) {
        this.pendingChanges.set(key, change);
      }
    }
  }

  private async readIfPresent(uri: vscode.Uri): Promise<NoteRecord | undefined> {
    try {
      return await readNoteRecord(uri);
    } catch (error) {
      if (error instanceof vscode.FileSystemError && error.code === "FileNotFound") {
        return undefined;
      }
      throw error;
    }
  }

  private commit(next: ReadonlyMap<string, NoteRecord>): void {
    if (this.disposed) {
      return;
    }

    this.notes.clear();
    for (const [key, note] of next) {
      this.notes.set(key, note);
    }
    /*
     * Handed over unsorted. `buildSnapshot` puts the notes in `compareNotes` order itself, and
     * this sorted them first by `localeCompare` — a slower comparison, on the same list, for an
     * order that was then thrown away.
     */
    this.currentSnapshot = freezeSnapshot(
      buildSnapshot(
        [...this.notes.values()],
        this.currentSnapshot.version + 1,
        Date.now(),
        this.projector,
      ),
    );
    this.changeEmitter.fire(this.currentSnapshot);
  }

  private enqueueOperation(operation: () => Promise<void>): Promise<void> {
    const run = this.operationTail.then(async () => {
      if (this.disposed) {
        return;
      }
      this.setStatus("indexing");
      try {
        await operation();
        this.errorMessage = undefined;
        this.setStatus("idle");
      } catch (error) {
        this.errorMessage = error instanceof Error ? error.message : String(error);
        this.setStatus("error");
        throw error;
      }
    });
    this.operationTail = run.catch(() => undefined);
    return run;
  }

  private setStatus(status: IndexStatus): void {
    if (this.currentStatus !== status && !this.disposed) {
      this.currentStatus = status;
      this.statusEmitter.fire(status);
    }
  }
}

function createProjector(): NoteProjector {
  const bypass = vscode.workspace
    .getConfiguration()
    .get<boolean>(BYPASS_PROJECTION_CACHE_SETTING) === true;
  return createNoteProjector({ cache: !bypass });
}
