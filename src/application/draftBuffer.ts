import { applyTextPatch } from "./textPatch";
import type { TextPatch } from "./textPatch";

export interface DraftPatch extends TextPatch {
  readonly sequence: number;
  readonly baseVersion: number;
}

export interface DraftBufferSnapshot {
  readonly acceptedSource: string;
  readonly acceptedVersion: number;
  readonly projectedSource: string;
  readonly acceptedSequence: number;
  readonly lastSequence: number;
  readonly saveRequested: boolean;
}

export class DraftBuffer {
  private accepted: string;
  private version: number;
  private projected: string;
  private sequence = 0;
  private settledSequence = 0;
  private baseVersionFloor: number;
  private wantsSave = false;

  public constructor(source: string, version: number) {
    this.accepted = source;
    this.projected = source;
    this.version = version;
    this.baseVersionFloor = version;
  }

  public get snapshot(): DraftBufferSnapshot {
    return {
      acceptedSource: this.accepted,
      acceptedVersion: this.version,
      projectedSource: this.projected,
      acceptedSequence: this.settledSequence,
      lastSequence: this.sequence,
      saveRequested: this.wantsSave,
    };
  }

  public push(patch: DraftPatch): boolean {
    if (!Number.isSafeInteger(patch.sequence) || patch.sequence <= 0) {
      throw new Error("The editor update sequence is invalid.");
    }
    if (patch.sequence <= this.sequence) return false;
    if (patch.baseVersion < this.baseVersionFloor || patch.baseVersion > this.version) {
      throw new Error("The editor update is based on an unknown document version.");
    }
    this.projected = applyTextPatch(this.projected, patch);
    this.sequence = patch.sequence;
    return true;
  }

  public nextDraft(): { readonly source: string; readonly sequence: number } | undefined {
    return this.projected === this.accepted
      ? undefined
      : { source: this.projected, sequence: this.sequence };
  }

  public accept(source: string, version: number, sequence: number): void {
    this.accepted = source;
    this.version = version;
    this.settledSequence = sequence;
  }

  public settleUnchangedDraft(): void {
    if (this.projected === this.accepted) this.settledSequence = this.sequence;
  }

  public requestSave(): void {
    this.wantsSave = true;
  }

  public takeSaveRequest(): boolean {
    if (!this.wantsSave || this.nextDraft() !== undefined) return false;
    this.wantsSave = false;
    return true;
  }

  public rebase(source: string, version: number): void {
    this.accepted = source;
    this.projected = source;
    this.version = version;
    this.baseVersionFloor = version;
    this.wantsSave = false;
  }
}
