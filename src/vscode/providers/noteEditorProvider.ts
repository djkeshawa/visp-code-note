import * as vscode from "vscode";
import { parseExternalLink } from "../../application/externalLink";
import { DraftRecoveryStore } from "../../application/draftRecoveryStore";
import { parseEditorContentWidth } from "../../application/editorContentWidth";
import { parseProseFont } from "../../application/proseFont";
import type { EditorContentWidth } from "../../application/editorContentWidth";
import type {
  EditorDocumentState,
  EditorMenuCommand,
  HostToEditorMessage,
} from "../../domain/protocol";
import { parseMarkdown } from "../../markdown/parser";
import { buildNoteContext, getBrokenLinks } from "../../indexing/projections";
import { createWikiReferenceResolver } from "../../indexing/wikiReferenceResolver";
import { createWikiTargetPlanner } from "../../indexing/noteResolver";
import { createEditorHtml } from "../../ui";
import type { CommandIndex } from "../commands/contracts";
import { createMissingNote } from "../commands/createMissingNote";
import { openNote } from "../commands/openNote";
import { COMMAND_IDS, NOTE_EDITOR_VIEW_TYPE } from "../ids";
import { isEditorMessage } from "./messageValidation";
import { pickTag } from "./tagPicker";
import { buildNoteSuggestions } from "./noteEditorSupport";
import { NoteEditorEdits } from "./noteEditorEdits";
import type { RecoverableNoteDraft } from "./noteEditorEdits";
import { NoteEditorPanelRegistry } from "./noteEditorPanelRegistry";

/**
 * Shows a read-only side-by-side comparison. Supplied by the host rather than created here,
 * because the content provider backing the diff has to be registered for its life.
 */
export type DiffPreview = (title: string, before: string, after: string) => Promise<void>;

export class NoteEditorProvider implements vscode.CustomTextEditorProvider, vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly pendingReveals = new Map<string, number>();
  private readonly panels: NoteEditorPanelRegistry;
  private readonly edits: NoteEditorEdits;

  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly index: CommandIndex,
    onDidActivateNote: (uri: string) => void,
    private readonly showDiffPreview: DiffPreview,
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
        if (event.affectsConfiguration(PROSE_FONT_SETTING)) {
          this.publishProseFont();
        }
        if (event.affectsConfiguration(SHOW_INSPECTOR_SETTING)) {
          this.publishInspectorVisibility();
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
    /*
     * Workspace-wide, so it is resolved once here rather than once per open note. Finding
     * broken links re-resolves every reference in the workspace, which is not something to
     * repeat per panel on every index change.
     */
    const brokenLinkCount = getBrokenLinks(this.index.snapshot).length;
    // Both of these scan the whole workspace to build and are the same for every open note.
    const planner = createWikiTargetPlanner(this.index.snapshot.notes);
    const resolver = createWikiReferenceResolver(this.index.snapshot.notes);
    for (const [uri, panels] of this.panels.entries()) {
      const document = openDocuments.get(uri);
      if (!document) continue;
      const suggestions = buildNoteSuggestions(this.index.snapshot.notes, uri, planner);
      const unresolvedLinks = this.unresolvedLinks(
        document,
        parseMarkdown(document.getText()).links,
        resolver,
      );
      const context = buildNoteContext(this.index.snapshot, uri);
      for (const panel of panels) {
        void panel.webview.postMessage({
          type: "editor/indexState",
          suggestions,
          unresolvedLinks,
          brokenLinkCount,
          ...(context === undefined ? {} : { context }),
        } satisfies HostToEditorMessage);
      }
    }
  }

  public get activeUri(): vscode.Uri | undefined {
    return this.panels.activeUri;
  }

  /** Asks the focused note editor to apply a frontmatter tag change to its own document. */
  public async applyTag(tag: string, mode: "add" | "remove"): Promise<boolean> {
    const panel = this.panels.active;
    if (!panel?.active || !this.panels.isReady(panel)) {
      return false;
    }
    await panel.webview.postMessage(
      mode === "add"
        ? ({ type: "editor/insertTag", tag } satisfies HostToEditorMessage)
        : ({ type: "editor/removeTag", tag } satisfies HostToEditorMessage),
    );
    return true;
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
          await updateSetting(CONTENT_WIDTH_SETTING, message.contentWidth);
          break;
        case "editor/setInspectorVisible":
          /*
           * Written to settings rather than kept per panel, so opening the next note does not
           * bring back a column that was deliberately closed.
           */
          await updateSetting(SHOW_INSPECTOR_SETTING, message.showInspector);
          break;
        case "editor/requestLink":
          await this.promptForLink(document, panel);
          break;
        case "editor/requestTag":
          await this.promptForTag(document, panel);
          break;
        case "editor/openLink":
          await this.openWikiLink(document, message.target, message.beside ?? false);
          break;
        case "editor/openExternal": {
          const url = parseExternalLink(message.url);
          if (url === undefined) {
            throw new Error("That link does not point anywhere Visp Notes will open.");
          }
          await vscode.env.openExternal(vscode.Uri.parse(url));
          break;
        }
        case "editor/openBacklink":
          await this.openBacklink(message.uri, message.start);
          break;
        case "editor/runCommand":
          await vscode.commands.executeCommand(MENU_COMMANDS[message.command]);
          break;
        case "editor/compareDraft":
          await this.showDiffPreview(
            `${this.noteTitle(document)} — file ↔ draft`,
            document.getText(),
            message.source,
          );
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

  /**
   * Opens the note a mention lives in, at the mention. Routed through the same pending-reveal
   * path as following a wiki link, so a backlink and a link behave the same on arrival.
   */
  private async openBacklink(uri: string, start: number): Promise<void> {
    const known = this.index.snapshot.backlinks.some(
      (backlink) => backlink.sourceUri === uri && backlink.range.start === start,
    );
    if (!known) return;
    this.pendingReveals.set(uri, start);
    await openNote(vscode.Uri.parse(uri), true);
    for (const panel of this.panels.forDocument(uri) ?? []) {
      if (this.panels.isReady(panel)) {
        await this.publishPendingReveal(uri, panel);
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
        showInspector: showInspectorSetting(),
        brokenLinkCount: getBrokenLinks(this.index.snapshot).length,
        ...(proseFontSetting() === undefined ? {} : { proseFont: proseFontSetting() }),
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
    sharedResolver?: ReturnType<typeof createWikiReferenceResolver>,
  ): readonly string[] {
    const resolver = sharedResolver ?? createWikiReferenceResolver(this.index.snapshot.notes);
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

  /**
   * Offers the workspace's tags, excluding those the note already declares in frontmatter.
   * The webview applies the chosen tag to its own document, so the edit travels through the
   * usual draft pipeline and stays undoable rather than arriving as an external change.
   */
  private async promptForTag(
    document: vscode.TextDocument,
    panel: vscode.WebviewPanel,
  ): Promise<void> {
    const context = buildNoteContext(this.index.snapshot, document.uri.toString());
    const tag = await pickTag(this.index.snapshot, {
      title: "Add a tag to this note",
      exclude: new Set((context?.frontmatterTags ?? []).map((name) => name.toLocaleLowerCase())),
    });
    if (tag !== undefined) {
      await panel.webview.postMessage({ type: "editor/insertTag", tag } satisfies HostToEditorMessage);
    }
  }

  private noteTitle(document: vscode.TextDocument): string {
    const fileName = document.uri.path.split("/").pop() ?? "Note";
    return fileName.replace(/\.md$/i, "");
  }

  private publishProseFont(): void {
    const fontFamily = proseFontSetting();
    for (const [, panels] of this.panels.entries()) {
      for (const panel of panels) {
        void panel.webview.postMessage({
          type: "editor/proseFont",
          ...(fontFamily === undefined ? {} : { fontFamily }),
        } satisfies HostToEditorMessage);
      }
    }
  }

  /**
   * Opens a note and shows the inspector beside it. Backlinks live there now, so "Show
   * Backlinks" means "put the note in front of me with its connections showing".
   */
  public async revealInspector(uri?: string): Promise<void> {
    const target = uri ?? this.panels.activeUri?.toString();
    if (target === undefined) {
      void vscode.window.showInformationMessage("Open a note to see what links to it.");
      return;
    }
    if (!showInspectorSetting()) {
      await updateSetting(SHOW_INSPECTOR_SETTING, true);
    }
    await openNote(vscode.Uri.parse(target), true);
  }

  private publishInspectorVisibility(): void {
    const showInspector = showInspectorSetting();
    for (const [, panels] of this.panels.entries()) {
      for (const panel of panels) {
        void panel.webview.postMessage({
          type: "editor/showInspector",
          showInspector,
        } satisfies HostToEditorMessage);
      }
    }
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

/** What the note's overflow menu can ask for, resolved to the commands the palette offers. */
const MENU_COMMANDS: Readonly<Record<EditorMenuCommand, string>> = {
  newTask: COMMAND_IDS.newTask,
  renameNote: COMMAND_IDS.renameNote,
  findBrokenLinks: COMMAND_IDS.findBrokenLinks,
  openLocalGraph: COMMAND_IDS.openLocalGraph,
  rebuildIndex: COMMAND_IDS.rebuildIndex,
};

const CONTENT_WIDTH_SETTING = "vispNotes.editor.contentWidth";

const PROSE_FONT_SETTING = "vispNotes.editor.fontFamily";

function proseFontSetting(): string | undefined {
  return parseProseFont(vscode.workspace.getConfiguration().get<string>(PROSE_FONT_SETTING));
}

const SHOW_INSPECTOR_SETTING = "vispNotes.editor.showInspector";

/**
 * Writes a setting to the scope that currently decides its value.
 *
 * Always writing Global looked right until a workspace set the same key: the write landed in
 * User settings, the effective value did not move, and the change event bounced the control
 * straight back to where it had been. Writing where the value actually comes from means the
 * control does what it says.
 */
async function updateSetting(section: string, value: unknown): Promise<void> {
  const scopes = vscode.workspace.getConfiguration().inspect(section);
  const target = scopes?.workspaceFolderValue !== undefined
    ? vscode.ConfigurationTarget.WorkspaceFolder
    : scopes?.workspaceValue !== undefined
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
  await vscode.workspace.getConfiguration().update(section, value, target);
}

function showInspectorSetting(): boolean {
  return vscode.workspace.getConfiguration().get<boolean>(SHOW_INSPECTOR_SETTING) !== false;
}

function contentWidthSetting(): EditorContentWidth {
  return parseEditorContentWidth(
    vscode.workspace.getConfiguration().get<string>(CONTENT_WIDTH_SETTING),
  );
}
