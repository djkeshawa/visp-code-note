import { applyTextPatch, createTextPatch } from "../../application/textPatch.js";
import type { TextPatch } from "../../application/textPatch.js";

export interface HostDocumentState {
  readonly source: string;
  readonly version: number;
  readonly dirty: boolean;
  readonly acknowledgedSequence?: number;
}

export type DocumentSyncAction =
  | {
      readonly type: "submit-edit";
      readonly expectedVersion: number;
      readonly sequence: number;
      readonly patch: TextPatch;
      readonly save: boolean;
    }
  | { readonly type: "save-document" }
  | { readonly type: "replace-local"; readonly source: string };

export type HostStateKind =
  | "initial"
  | "metadata"
  | "ack"
  | "external"
  | "conflict"
  | "rejected"
  | "stale";

export interface HostStateTransition {
  readonly kind: HostStateKind;
  readonly actions: readonly DocumentSyncAction[];
}

export interface DocumentSyncSnapshot {
  readonly ready: boolean;
  readonly localSource: string;
  readonly baseline?: HostDocumentState;
  readonly conflict?: HostDocumentState;
  readonly localDirty: boolean;
  readonly editPending: boolean;
  readonly savePending: boolean;
  readonly saveRequested: boolean;
  readonly failed: boolean;
}

interface InFlightEdit {
  readonly source: string;
  readonly save: boolean;
  readonly sequence: number;
  failed: boolean;
}

export class DocumentSyncModel {
  private baselineState: HostDocumentState | undefined;
  private currentLocalSource = "";
  private conflictState: HostDocumentState | undefined;
  private inFlightEdit: InFlightEdit | undefined;
  private saveInFlight = false;
  private wantsSave = false;
  private failure = false;
  private sequence = 0;

  public constructor(initialState?: HostDocumentState) {
    if (initialState !== undefined) {
      this.baselineState = initialState;
      this.currentLocalSource = initialState.source;
      this.sequence = initialState.acknowledgedSequence ?? 0;
    }
  }

  public get snapshot(): DocumentSyncSnapshot {
    const baseline = this.baselineState;
    return {
      ready: baseline !== undefined,
      localSource: this.currentLocalSource,
      ...(baseline === undefined ? {} : { baseline }),
      ...(this.conflictState === undefined ? {} : { conflict: this.conflictState }),
      localDirty: baseline !== undefined && this.currentLocalSource !== baseline.source,
      editPending: this.inFlightEdit !== undefined,
      savePending: this.saveInFlight,
      saveRequested: this.wantsSave,
      failed: this.failure,
    };
  }

  public onLocalChange(source: string): readonly DocumentSyncAction[] {
    const patch = createTextPatch(this.currentLocalSource, source);
    return patch === undefined ? [] : this.onLocalPatch(patch);
  }

  public onLocalPatch(patch: TextPatch): readonly DocumentSyncAction[] {
    const source = applyTextPatch(this.currentLocalSource, patch);
    this.currentLocalSource = source;
    const baseline = this.baselineState;
    if (baseline === undefined || this.conflictState !== undefined || this.failure) {
      return [];
    }
    const save = this.wantsSave;
    const sequence = ++this.sequence;
    this.inFlightEdit = { source, save, sequence, failed: false };
    return [{
      type: "submit-edit",
      expectedVersion: baseline.version,
      sequence,
      patch,
      save,
    }];
  }

  public requestSave(): readonly DocumentSyncAction[] {
    this.wantsSave = true;
    if (this.conflictState !== undefined || this.failure) {
      return [];
    }
    return this.startNextOperation();
  }

  public onHostState(incoming: HostDocumentState): HostStateTransition {
    const baseline = this.baselineState;
    if (baseline === undefined) {
      this.sequence = Math.max(this.sequence, incoming.acknowledgedSequence ?? 0);
      this.baselineState = incoming;
      this.currentLocalSource = incoming.source;
      this.completeSaveIfClean(incoming);
      return transition("initial", [{ type: "replace-local", source: incoming.source }]);
    }

    if (this.conflictState !== undefined) {
      return this.updateConflict(incoming);
    }

    if (incoming.version < baseline.version) {
      return transition("stale");
    }

    const inFlight = this.inFlightEdit;
    if (inFlight !== undefined) {
      if (
        incoming.acknowledgedSequence !== undefined &&
        incoming.acknowledgedSequence < inFlight.sequence &&
        incoming.version >= baseline.version
      ) {
        this.baselineState = incoming;
        this.completeSaveIfClean(incoming);
        return transition("ack");
      }
      const acknowledgesLatest = incoming.acknowledgedSequence === inFlight.sequence;
      if (
        acknowledgesLatest &&
        !incoming.dirty &&
        incoming.source !== inFlight.source &&
        (inFlight.save || this.wantsSave || this.saveInFlight)
      ) {
        this.baselineState = incoming;
        this.currentLocalSource = incoming.source;
        this.inFlightEdit = undefined;
        this.saveInFlight = false;
        this.completeSaveIfClean(incoming);
        return transition("ack", [{ type: "replace-local", source: incoming.source }]);
      }
      if (
        incoming.source === inFlight.source &&
        (incoming.version > baseline.version || acknowledgesLatest)
      ) {
        this.baselineState = incoming;
        this.inFlightEdit = undefined;
        this.saveInFlight = false;
        this.completeSaveIfClean(incoming);
        if (inFlight.failed) {
          this.failure = true;
          return transition("ack");
        }
        return transition("ack", this.startNextOperation());
      }

      if (sameRevision(incoming, baseline)) {
        this.baselineState = incoming;
        if (inFlight.failed) {
          this.inFlightEdit = undefined;
          this.failure = true;
          return transition("rejected");
        }
        return transition("metadata");
      }

      return this.enterConflict(incoming);
    }

    if (sameRevision(incoming, baseline)) {
      this.baselineState = incoming;
      this.completeSaveIfClean(incoming);
      return transition("metadata");
    }

    if (incoming.source === this.currentLocalSource) {
      this.baselineState = incoming;
      this.failure = false;
      this.completeSaveIfClean(incoming);
      return transition("ack", this.startNextOperation());
    }

    if (this.currentLocalSource === baseline.source && !this.failure) {
      this.baselineState = incoming;
      this.currentLocalSource = incoming.source;
      this.completeSaveIfClean(incoming);
      return transition("external", [{ type: "replace-local", source: incoming.source }]);
    }

    return this.enterConflict(incoming);
  }

  public markSubmissionFailed(): boolean {
    if (this.inFlightEdit !== undefined) {
      this.inFlightEdit.failed = true;
      this.saveInFlight = false;
      this.failure = true;
      return true;
    }
    if (this.saveInFlight) {
      this.saveInFlight = false;
      this.failure = true;
      return true;
    }
    return false;
  }

  public rejectCurrentEdit(): boolean {
    if (this.inFlightEdit === undefined) {
      return false;
    }
    this.inFlightEdit = undefined;
    this.saveInFlight = false;
    this.failure = true;
    return true;
  }

  public retry(): readonly DocumentSyncAction[] {
    if (this.conflictState !== undefined || this.inFlightEdit !== undefined || this.saveInFlight) {
      return [];
    }
    this.failure = false;
    return this.startNextOperation();
  }

  public useExternal(): readonly DocumentSyncAction[] {
    const incoming = this.conflictState;
    if (incoming === undefined) {
      return [];
    }
    this.baselineState = incoming;
    this.currentLocalSource = incoming.source;
    this.conflictState = undefined;
    this.inFlightEdit = undefined;
    this.saveInFlight = false;
    this.wantsSave = false;
    this.failure = false;
    return [{ type: "replace-local", source: incoming.source }];
  }

  public keepLocal(): readonly DocumentSyncAction[] {
    const incoming = this.conflictState;
    if (incoming === undefined) {
      return [];
    }
    this.baselineState = incoming;
    this.conflictState = undefined;
    this.inFlightEdit = undefined;
    this.saveInFlight = false;
    this.failure = false;
    this.completeSaveIfClean(incoming);
    return this.startNextOperation();
  }

  public recoverDraft(source: string, saveRequested: boolean): HostStateTransition {
    const baseline = this.baselineState;
    if (baseline === undefined || source === baseline.source) return transition("metadata");
    this.currentLocalSource = source;
    this.conflictState = baseline;
    this.inFlightEdit = undefined;
    this.saveInFlight = false;
    this.wantsSave = saveRequested;
    this.failure = false;
    return transition("conflict", [{ type: "replace-local", source }]);
  }

  private startNextOperation(): readonly DocumentSyncAction[] {
    const baseline = this.baselineState;
    if (
      baseline === undefined ||
      this.conflictState !== undefined ||
      this.failure ||
      this.inFlightEdit !== undefined ||
      this.saveInFlight
    ) {
      return [];
    }

    const patch = createTextPatch(baseline.source, this.currentLocalSource);
    if (patch !== undefined) {
      const save = this.wantsSave;
      const sequence = ++this.sequence;
      this.inFlightEdit = { source: this.currentLocalSource, save, sequence, failed: false };
      return [{
        type: "submit-edit",
        expectedVersion: baseline.version,
        sequence,
        patch,
        save,
      }];
    }

    if (this.wantsSave) {
      if (baseline.dirty) {
        this.saveInFlight = true;
        return [{ type: "save-document" }];
      }
      this.wantsSave = false;
    }
    return [];
  }

  private enterConflict(incoming: HostDocumentState): HostStateTransition {
    this.conflictState = incoming;
    this.inFlightEdit = undefined;
    this.saveInFlight = false;
    this.failure = false;
    return transition("conflict");
  }

  private updateConflict(incoming: HostDocumentState): HostStateTransition {
    const conflict = this.conflictState;
    if (conflict !== undefined && incoming.version < conflict.version) {
      return transition("stale");
    }
    if (incoming.source === this.currentLocalSource) {
      this.baselineState = incoming;
      this.conflictState = undefined;
      this.failure = false;
      this.completeSaveIfClean(incoming);
      return transition("ack", this.startNextOperation());
    }
    this.conflictState = incoming;
    return sameRevision(incoming, conflict) ? transition("metadata") : transition("conflict");
  }

  private completeSaveIfClean(incoming: HostDocumentState): void {
    if (!incoming.dirty && incoming.source === this.currentLocalSource) {
      this.wantsSave = false;
      this.saveInFlight = false;
      this.failure = false;
    }
  }
}

function sameRevision(
  left: HostDocumentState,
  right: HostDocumentState | undefined,
): boolean {
  return right !== undefined && left.version === right.version && left.source === right.source;
}

function transition(
  kind: HostStateKind,
  actions: readonly DocumentSyncAction[] = [],
): HostStateTransition {
  return { kind, actions };
}
