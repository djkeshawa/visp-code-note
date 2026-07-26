import * as vscode from "vscode";
import { DraftRecoveryStore } from "../../application/draftRecoveryStore";
import { parseEditorContentWidth } from "../../application/editorContentWidth";
import type { EditorContentWidth } from "../../application/editorContentWidth";
import type { EditorDocumentState, HostToEditorMessage } from "../../domain/protocol";
import { parseMarkdown } from "../../markdown/parser";
import { buildNoteContext } from "../../indexing/projections";
import { createWikiReferenceResolver } from "../../indexing/wikiReferenceResolver";
import { createEditorHtml } from "../../ui";
import type { CommandIndex } from "../commands/contracts";
import { createMissingNote } from "../commands/createMissingNote";
import { openNote } from "../commands/openNote";
import { NOTE_EDITOR_VIEW_TYPE } from "../ids";
import { isEditorMessage } from "./messageValidation";
import { buildNoteSuggestions } from "./noteEditorSupport";
import { NoteEditorEdits } from "./noteEditorEdits";
import type { RecoverableNoteDraft } from "./noteEditorEdits";
import { NoteEditorPanelRegistry } from "./noteEditorPanelRegistry";

export class NoteEditorProvider implements vscode.CustomTextEditorProvider, vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly pendingReveals = new Map<string, number>();
  private readonly panels: NoteEditorPanelRegistry;
  private readonly edits: NoteEditorEdits;

  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly index: CommandIndex,
    onDidActivateNote: (uri: string) => void,
    recoveryStore = new DraftRecoveryStore(),
  ) {
    this.edits = new NoteEditorEdits(recoveryStore);
    this.panels = new NoteEditorPanelRegistry(
      onDidActivateNote,
      (panel) => this.edits.release(panel),
    );
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((event) => this.publishDocument(event.document)),
      vscode.workspace.onDidSaveTextDocument((document) => this.publishDocument(document)),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration(CONTENT_WIDTH_SETTING)) {
          this.publishContentWidth();
        }
      }),
    );
  }

  public register(): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(NOTE_EDITOR_VIEW_TYPE, this, {
      supportsMultipleEditorsPerDocument: false,
      webviewOptions: { retainContextWhenHidden: true },
    });
  }

  public resolveCustomTextEditor(
    document: vscode.TextDocument,
    panel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): void {
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
    };
    panel.webview.html = createEditorHtml({ webview: panel.webview, extensionUri: this.extensionUri });
    panel.title = this.noteTitle(document);
    this.panels.track(document, panel);

    const messageSubscription = panel.webview.onDidReceiveMessage(
      (message: unknown) => this.handleMessage(document, panel, message),
    );
    this.panels.addSubscription(panel, messageSubscription);
  }

  public async toggle(uri?: vscode.Uri): Promise<void> {
    if (this.panels.active?.active) {
      await this.panels.active.webview.postMessage({ type: "editor/toggleMode" } satisfies HostToEditorMessage);
      return;
    }
    if (uri) {
      await openNote(uri, true);
    }
  }

  public updateIndexState(): void {
    const openDocuments = new Map(
      vscode.workspace.textDocuments.map((document) => [document.uri.toString(), document]),
    );
    for (const [uri, panels] of this.panels.entries()) {
      const document = openDocuments.get(uri);
      if (!document) continue;
      const suggestions = buildNoteSuggestions(this.index.snapshot.notes, uri);
      const unresolvedLinks = this.unresolvedLinks(document, parseMarkdown(document.getText()).links);
      for (const panel of panels) {
        void panel.webview.postMessage({
          type: "editor/indexState",
          suggestions,
          unresolvedLinks,
        } satisfies HostToEditorMessage);
      }
    }
  }

  public get activeUri(): vscode.Uri | undefined {
    return this.panels.activeUri;
  }

  public async insertLink(target: string): Promise<boolean> {
    const panel = this.panels.active;
    if (!panel?.active || !this.panels.isReady(panel)) {
      return false;
    }
    await panel.webview.postMessage({
      type: "editor/insertLink",
      target,
    } satisfies HostToEditorMessage);
    return true;
  }

  public dispose(): void {
    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose();
    }
    this.panels.dispose();
    this.edits.dispose();
    this.pendingReveals.clear();
  }

  private async handleMessage(
    document: vscode.TextDocument,
    panel: vscode.WebviewPanel,
    value: unknown,
  ): Promise<void> {
    if (!isEditorMessage(value)) {
      return;
    }
    const message = value;
    try {
      switch (message.type) {
        case "editor/ready":
          this.panels.markReady(panel);
          await this.edits.waitForDocument(document.uri.toString());
          await this.publishInitialState(
            document,
            panel,
            this.edits.lastSequence(panel),
            this.edits.recoverable(document, panel),
          );
          await this.publishPendingReveal(document.uri.toString(), panel);
          break;
        case "editor/editSource":
          await this.edits.apply(document, panel, {
            start: message.start,
            end: message.end,
            source: message.source,
            expectedSource: message.expectedSource,
            expectedVersion: message.version,
            sequence: message.sequence,
            save: message.save ?? false,
          }, (sequence) => this.publishDocumentState(document, panel, sequence));
          break;
        case "editor/save":
          await this.edits.save(
            document,
            panel,
            (sequence) => this.publishDocumentState(document, panel, sequence),
          );
          break;
        case "editor/discardDraft":
          this.edits.discard(document, panel, message.version);
          break;
        case "editor/stashDraft":
          this.edits.stash(document, {
            source: message.source,
            saveRequested: message.saveRequested,
          });
          break;
        case "editor/setContentWidth":
          await vscode.workspace.getConfiguration().update(
            CONTENT_WIDTH_SETTING,
            message.contentWidth,
            vscode.ConfigurationTarget.Global,
          );
          break;
        case "editor/requestLink":
          await this.promptForLink(document, panel);
          break;
        case "editor/openLink":
          await this.openWikiLink(document, message.target, message.beside ?? false);
          break;
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const operation = message.type === "editor/editSource" ||
          message.type === "editor/save" ||
          message.type === "editor/stashDraft" ||
          message.type === "editor/discardDraft"
        ? "sync"
        : "link";
      await panel.webview.postMessage({
        type: "editor/error",
        operation,
        message: detail,
      } satisfies HostToEditorMessage);
      if (
        message.type === "editor/editSource" ||
        message.type === "editor/save" ||
        message.type === "editor/stashDraft" ||
        message.type === "editor/discardDraft"
      ) {
        await this.publishDocumentState(document, panel);
      }
    }
  }

  private async openWikiLink(
    document: vscode.TextDocument,
    target: string,
    beside: boolean,
  ): Promise<void> {
    const reference = parseMarkdown(`[[${target}]]`).links[0];
    if (reference === undefined) {
      throw new Error("The wiki-link target is invalid.");
    }
    const result = createWikiReferenceResolver(this.index.snapshot.notes)
      .resolve(document.uri.toString(), reference);
    if (result.status === "resolved") {
      if (result.offset !== undefined) {
        this.pendingReveals.set(result.note.uri, result.offset);
      }
      await openNote(vscode.Uri.parse(result.note.uri), true, beside);
      const panels = this.panels.forDocument(result.note.uri);
      if (panels) {
        for (const targetPanel of panels) {
          if (this.panels.isReady(targetPanel)) {
            await this.publishPendingReveal(result.note.uri, targetPanel);
          }
        }
      }
      return;
    }

    if (result.status === "missing-heading") {
      void vscode.window.showWarningMessage(
        `The heading “${result.heading}” does not exist in “${result.note.title}”.`,
      );
      return;
    }
    if (result.status === "missing-block") {
      void vscode.window.showWarningMessage(
        `The block “^${result.blockId}” does not exist in “${result.note.title}”.`,
      );
      return;
    }

    const targetName = result.target;
    const create = await vscode.window.showInformationMessage(
      `The note “${targetName}” does not exist.`,
      "Create Note",
    );
    if (create === "Create Note") {
      await createMissingNote(this.index, document.uri, targetName);
    }
  }

  private publishDocument(document: vscode.TextDocument): void {
    if (this.edits.isInFlight(document.uri.toString())) {
      return;
    }
    this.edits.observe(document);
    const documentPanels = this.panels.forDocument(document.uri.toString());
    if (!documentPanels) {
      return;
    }
    for (const panel of documentPanels) {
      void this.publishDocumentState(document, panel);
    }
  }

  private async publishInitialState(
    document: vscode.TextDocument,
    panel: vscode.WebviewPanel,
    acknowledgedSequence?: number,
    recoveredDraft?: RecoverableNoteDraft,
  ): Promise<void> {
    const state = this.documentState(document, acknowledgedSequence);
    panel.title = state.title;
    await panel.webview.postMessage({
      type: "editor/state",
      state: {
        uri: document.uri.toString(),
        ...state,
        noteSuggestions: buildNoteSuggestions(this.index.snapshot.notes, document.uri.toString()),
        contentWidth: contentWidthSetting(),
        ...(recoveredDraft === undefined ? {} : { recoveredDraft }),
      },
    } satisfies HostToEditorMessage);
  }

  private async publishDocumentState(
    document: vscode.TextDocument,
    panel: vscode.WebviewPanel,
    acknowledgedSequence?: number,
  ): Promise<void> {
    const state = this.documentState(document, acknowledgedSequence);
    panel.title = state.title;
    await panel.webview.postMessage({
      type: "editor/documentState",
      state,
    } satisfies HostToEditorMessage);
  }

  private documentState(
    document: vscode.TextDocument,
    acknowledgedSequence?: number,
  ): EditorDocumentState {
    const source = document.getText();
    const parsed = parseMarkdown(source);
    const context = buildNoteContext(this.index.snapshot, document.uri.toString());
    return {
      title: parsed.title ?? this.noteTitle(document),
      source,
      unresolvedLinks: this.unresolvedLinks(document, parsed.links),
      version: document.version,
      dirty: document.isDirty,
      ...(acknowledgedSequence === undefined ? {} : { acknowledgedSequence }),
      ...(context === undefined ? {} : { context }),
    };
  }

  private unresolvedLinks(
    document: vscode.TextDocument,
    links: ReturnType<typeof parseMarkdown>["links"],
  ): readonly string[] {
    const resolver = createWikiReferenceResolver(this.index.snapshot.notes);
    return links
      .filter((link) => resolver.resolve(document.uri.toString(), link).status !== "resolved")
      .map((link) => link.raw);
  }

  private async promptForLink(
    document: vscode.TextDocument,
    panel: vscode.WebviewPanel,
  ): Promise<void> {
    const selected = await vscode.window.showQuickPick(
      buildNoteSuggestions(this.index.snapshot.notes, document.uri.toString()).map((suggestion) => ({
        label: suggestion.label,
        description: suggestion.path,
        detail: suggestion.aliases.length === 0
          ? undefined
          : `Aliases: ${suggestion.aliases.join(", ")}`,
        target: suggestion.target,
      })),
      { placeHolder: "Link to a note", matchOnDescription: true, matchOnDetail: true },
    );
    if (selected !== undefined) {
      await panel.webview.postMessage({
        type: "editor/insertLink",
        target: selected.target,
      } satisfies HostToEditorMessage);
    }
  }

  private noteTitle(document: vscode.TextDocument): string {
    const fileName = document.uri.path.split("/").pop() ?? "Note";
    return fileName.replace(/\.md$/i, "");
  }

  private publishContentWidth(): void {
    const contentWidth = contentWidthSetting();
    for (const [, panels] of this.panels.entries()) {
      for (const panel of panels) {
        void panel.webview.postMessage({
          type: "editor/contentWidth",
          contentWidth,
        } satisfies HostToEditorMessage);
      }
    }
  }

  private async publishPendingReveal(uri: string, panel: vscode.WebviewPanel): Promise<void> {
    const offset = this.pendingReveals.get(uri);
    if (offset === undefined) {
      return;
    }
    await panel.webview.postMessage({ type: "editor/reveal", offset } satisfies HostToEditorMessage);
    this.pendingReveals.delete(uri);
  }

}

const CONTENT_WIDTH_SETTING = "vispNotes.editor.contentWidth";

function contentWidthSetting(): EditorContentWidth {
  return parseEditorContentWidth(
    vscode.workspace.getConfiguration().get<string>(CONTENT_WIDTH_SETTING),
  );
}
