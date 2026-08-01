import * as vscode from "vscode";
import { DraftBuffer } from "../../application/draftBuffer";
import { DraftRecoveryStore } from "../../application/draftRecoveryStore";
import type { RecoverableDraft } from "../../application/draftRecoveryStore";
import { createTextPatch } from "../../application/textPatch";
import { toRange } from "../documentEdits";

export interface NoteEditorEditRequest {
  readonly start: number;
  readonly end: number;
  readonly source: string;
  readonly expectedSource: string;
  readonly expectedVersion: number;
  readonly sequence: number;
  readonly save: boolean;
}

interface EditSession {
  readonly document: vscode.TextDocument;
  readonly panel: vscode.WebviewPanel;
  readonly publish: (acknowledgedSequence?: number) => Promise<void>;
  readonly buffer: DraftBuffer;
  running?: Promise<void>;
  applying: boolean;
  failed: boolean;
  disposed: boolean;
}

export type RecoverableNoteDraft = RecoverableDraft;

export class NoteEditorEdits {
  private readonly sessions = new Map<vscode.WebviewPanel, EditSession>();

  public constructor(private readonly recoveries = new DraftRecoveryStore()) {}

  public apply(
    document: vscode.TextDocument,
    panel: vscode.WebviewPanel,
    request: NoteEditorEditRequest,
    publish: (acknowledgedSequence?: number) => Promise<void>,
  ): Promise<void> {
    let session = this.sessions.get(panel);
    if (session === undefined) {
      if (document.version !== request.expectedVersion) throw changedElsewhere();
      session = this.createSession(document, panel, publish);
    } else if (session.failed) {
      if (document.version !== request.expectedVersion) throw changedElsewhere();
      session.buffer.rebase(document.getText(), document.version);
      session.failed = false;
    } else if (
      session.running === undefined &&
      session.buffer.nextDraft() === undefined &&
      request.expectedVersion === document.version &&
      (
        session.buffer.snapshot.acceptedVersion !== document.version ||
        session.buffer.snapshot.acceptedSource !== document.getText()
      )
    ) {
      session.buffer.rebase(document.getText(), document.version);
    }

    try {
      session.buffer.push({
        start: request.start,
        end: request.end,
        source: request.source,
        expectedSource: request.expectedSource,
        sequence: request.sequence,
        baseVersion: request.expectedVersion,
      });
      if (request.save) session.buffer.requestSave();
    } catch (error) {
      session.failed = true;
      this.captureRecovery(session);
      throw error;
    }
    return this.start(session);
  }

  public save(
    document: vscode.TextDocument,
    panel: vscode.WebviewPanel,
    publish: (acknowledgedSequence?: number) => Promise<void>,
  ): Promise<void> {
    const session = this.sessions.get(panel) ?? this.createSession(document, panel, publish);
    session.buffer.requestSave();
    return this.start(session);
  }

  public observe(document: vscode.TextDocument): void {
    for (const session of this.sessions.values()) {
      if (
        session.document.uri.toString() === document.uri.toString() &&
        session.running === undefined &&
        session.buffer.nextDraft() === undefined
      ) {
        session.buffer.rebase(document.getText(), document.version);
      }
    }
  }

  public discard(
    document: vscode.TextDocument,
    panel: vscode.WebviewPanel,
    version: number,
  ): void {
    if (document.version !== version) throw changedElsewhere();
    this.recoveries.delete(document.uri.toString());
    const session = this.sessions.get(panel);
    if (session === undefined) return;
    if (session.running !== undefined) {
      throw new Error("Wait for the current editor update before using the external version.");
    }
    session.buffer.rebase(document.getText(), document.version);
    session.failed = false;
  }

  public stash(document: vscode.TextDocument, draft: RecoverableNoteDraft): void {
    const key = document.uri.toString();
    if (draft.source === document.getText()) {
      this.recoveries.delete(key);
    } else {
      this.recoveries.set(key, draft);
    }
  }

  public lastSequence(panel: vscode.WebviewPanel): number | undefined {
    const sequence = this.sessions.get(panel)?.buffer.snapshot.lastSequence;
    return sequence === undefined || sequence === 0 ? undefined : sequence;
  }

  /**
   * Whether everything the reader has typed is on disk.
   *
   * Several steps of a save can fail, and one of them failing after the file has already been
   * written told the reader their note could not be saved when it plainly had been — the banner
   * only cleared when they pressed save a second time and nothing was left to do. If the
   * document is clean and holds exactly what the draft projects, the save achieved what it was
   * for, whichever step raised.
   */
  public settled(document: vscode.TextDocument, panel: vscode.WebviewPanel): boolean {
    if (document.isDirty) return false;
    const session = this.sessions.get(panel);
    if (session === undefined) return true;
    const snapshot = session.buffer.snapshot;
    return snapshot.projectedSource === document.getText() &&
      session.buffer.nextDraft() === undefined;
  }

  public async waitForDocument(uri: string): Promise<void> {
    const operations = [...this.sessions.values()]
      .filter((session) => session.document.uri.toString() === uri)
      .flatMap((session) => session.running === undefined ? [] : [session.running]);
    await Promise.all(operations.map((operation) => operation.catch(() => undefined)));
  }

  public recoverable(
    document: vscode.TextDocument,
    panel: vscode.WebviewPanel,
  ): RecoverableNoteDraft | undefined {
    const key = document.uri.toString();
    const recovery = this.recoveries.get(key);
    if (recovery?.source === document.getText()) {
      this.recoveries.delete(key);
      return undefined;
    }
    if (recovery !== undefined) return recovery;
    const session = this.sessions.get(panel);
    if (session?.failed === true && session.buffer.snapshot.projectedSource !== document.getText()) {
      return {
        source: session.buffer.snapshot.projectedSource,
        saveRequested: session.buffer.snapshot.saveRequested,
      };
    }
    return recovery;
  }

  public isInFlight(uri: string): boolean {
    return [...this.sessions.values()].some(
      (session) => session.document.uri.toString() === uri && session.applying,
    );
  }

  public release(panel: vscode.WebviewPanel): void {
    const session = this.sessions.get(panel);
    if (session === undefined) return;
    session.disposed = true;
    if (session.running === undefined) {
      this.captureRecovery(session);
      this.sessions.delete(panel);
    }
  }

  public dispose(): void {
    for (const session of this.sessions.values()) this.captureRecovery(session);
    this.sessions.clear();
  }

  private createSession(
    document: vscode.TextDocument,
    panel: vscode.WebviewPanel,
    publish: (acknowledgedSequence?: number) => Promise<void>,
  ): EditSession {
    const session: EditSession = {
      document,
      panel,
      publish,
      buffer: new DraftBuffer(document.getText(), document.version),
      applying: false,
      failed: false,
      disposed: false,
    };
    this.sessions.set(panel, session);
    return session;
  }

  private start(session: EditSession): Promise<void> {
    if (session.running !== undefined) return Promise.resolve();
    const operation = this.drain(session);
    session.running = operation;
    return operation.finally(() => {
      if (session.running === operation) session.running = undefined;
      if (session.disposed) {
        this.captureRecovery(session);
        this.sessions.delete(session.panel);
      }
    });
  }

  private async drain(session: EditSession): Promise<void> {
    try {
      while (true) {
        const draft = session.buffer.nextDraft();
        if (draft !== undefined) {
          this.assertCurrent(session);
          await this.applyTarget(session, draft.source);
          session.buffer.accept(draft.source, session.document.version, draft.sequence);
          continue;
        }
        session.buffer.settleUnchangedDraft();
        if (session.buffer.takeSaveRequest()) {
          await this.saveCurrent(session);
          continue;
        }

        const sequence = session.buffer.snapshot.acceptedSequence;
        await session.publish(sequence > 0 ? sequence : undefined);
        if (
          session.buffer.nextDraft() === undefined &&
          session.buffer.snapshot.acceptedSequence === session.buffer.snapshot.lastSequence &&
          !session.buffer.snapshot.saveRequested
        ) {
          session.failed = false;
          this.recoveries.delete(session.document.uri.toString());
          return;
        }
      }
    } catch (error) {
      session.failed = true;
      this.captureRecovery(session);
      throw error;
    }
  }

  private async applyTarget(session: EditSession, target: string): Promise<void> {
    const source = session.document.getText();
    const patch = createTextPatch(source, target);
    if (patch === undefined) return;
    const edit = new vscode.WorkspaceEdit();
    edit.replace(session.document.uri, toRange(session.document, patch), patch.source);
    session.applying = true;
    try {
      if (!(await vscode.workspace.applyEdit(edit))) {
        throw new Error("VS Code rejected the Markdown edit.");
      }
    } finally {
      session.applying = false;
    }
    if (session.document.getText() !== target) throw changedElsewhere();
  }

  private async saveCurrent(session: EditSession): Promise<void> {
    this.assertCurrent(session);
    const before = session.buffer.snapshot.acceptedSource;
    session.applying = true;
    try {
      if (!(await session.document.save())) {
        session.buffer.requestSave();
        throw new Error("VS Code could not save the note.");
      }
    } finally {
      session.applying = false;
    }

    const saved = session.document.getText();
    if (saved !== before && session.buffer.snapshot.projectedSource !== before) {
      throw new Error("The note changed while save-time formatting was applied. Your draft was preserved.");
    }
    if (saved === before) {
      session.buffer.accept(
        saved,
        session.document.version,
        session.buffer.snapshot.acceptedSequence,
      );
    }
    else session.buffer.rebase(saved, session.document.version);
  }

  private assertCurrent(session: EditSession): void {
    const snapshot = session.buffer.snapshot;
    if (
      session.document.version !== snapshot.acceptedVersion ||
      session.document.getText() !== snapshot.acceptedSource
    ) {
      throw changedElsewhere();
    }
  }

  private captureRecovery(session: EditSession): void {
    const snapshot = session.buffer.snapshot;
    if (snapshot.projectedSource === session.document.getText()) return;
    const key = session.document.uri.toString();
    if (session.failed && this.recoveries.get(key) !== undefined) return;
    this.recoveries.set(key, {
      source: snapshot.projectedSource,
      saveRequested: snapshot.saveRequested,
    });
  }

}

function changedElsewhere(): Error {
  return new Error("The note changed elsewhere. Your local edits were preserved for review.");
}
