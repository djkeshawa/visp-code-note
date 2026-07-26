import {
  Annotation,
  Compartment,
  EditorState,
  Prec,
  Transaction,
} from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import {
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  autocompletion,
} from "@codemirror/autocomplete";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { bracketMatching } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightSpecialChars,
  keymap,
  placeholder,
  rectangularSelection,
} from "@codemirror/view";
import type { OffsetTextEdit } from "../../application/textEdits.js";
import type { NoteSuggestionWire } from "../contracts.js";
import { codeLanguages } from "./codeLanguages.js";
import { vispEditorTheme } from "./editorTheme.js";
import {
  createEditorDocument,
  normalizeEditorInput,
  serializeEditorDocument,
} from "./editorDocument.js";
import { createEditorPatch } from "./editorPatch.js";
import { createLivePreview, refreshLivePreview, revealLiveLine } from "./livePreview.js";
import { isRecognizedWikiLink, markdownContext } from "./markdownContext.js";
import { detectLineSeparator, rawOffsetToEditorOffset } from "./offsetMapping.js";
import type { LineSeparator } from "./offsetMapping.js";
import { createWikiCompletionSource } from "./wikiCompletion.js";
import { planWikiLinkInsertion } from "./wikiLinkInsertion.js";
import { findWikiLinkAtPosition } from "./wikiLinkNavigation.js";
import type { TextPatch } from "../../application/textPatch.js";

export type MarkdownEditorMode = "live" | "markdown";

export interface CodeMirrorEditorDependencies {
  readonly suggestions: () => readonly NoteSuggestionWire[];
  readonly unresolvedLinks: () => ReadonlySet<string>;
  readonly sourcePatched: (patch: TextPatch) => void;
  readonly saveRequested: () => void;
  readonly openLink: (target: string, beside: boolean) => void;
}

const hostTransaction = Annotation.define<boolean>();

export class CodeMirrorEditor {
  private readonly previewCompartment = new Compartment();
  private readonly readOnlyCompartment = new Compartment();
  private readonly previewExtension: Extension;
  private view: EditorView;
  private lineSeparator: LineSeparator;
  private rawSource: string;
  private mode: MarkdownEditorMode = "live";
  private readOnly = false;
  private revealTimer: number | undefined;

  public constructor(
    private readonly host: HTMLElement,
    private readonly cspNonce: string,
    source: string,
    private readonly dependencies: CodeMirrorEditorDependencies,
  ) {
    this.lineSeparator = detectLineSeparator(source);
    this.rawSource = source;
    this.previewExtension = createLivePreview({
      unresolvedLinks: dependencies.unresolvedLinks,
      openLink: dependencies.openLink,
    });
    this.host.classList.add("is-live-mode");
    this.view = new EditorView({
      parent: host,
      state: this.createState(source),
    });
  }

  public get source(): string {
    return this.rawSource;
  }

  public get currentMode(): MarkdownEditorMode {
    return this.mode;
  }

  public setMode(mode: MarkdownEditorMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.host.classList.toggle("is-live-mode", mode === "live");
    this.view.dispatch({
      effects: this.previewCompartment.reconfigure(mode === "live" ? this.previewExtension : []),
    });
  }

  public toggleMode(): MarkdownEditorMode {
    const mode = this.mode === "live" ? "markdown" : "live";
    this.setMode(mode);
    return mode;
  }

  public setReadOnly(readOnly: boolean): void {
    if (readOnly === this.readOnly) return;
    this.readOnly = readOnly;
    this.view.dispatch({
      effects: [
        this.readOnlyCompartment.reconfigure(readOnlyExtensions(readOnly)),
        refreshLivePreview.of(undefined),
      ],
    });
  }

  public replaceSource(source: string): void {
    if (source === this.source) return;
    const nextSeparator = detectLineSeparator(source);
    if (nextSeparator !== this.lineSeparator) {
      const selection = this.view.state.selection.main;
      this.lineSeparator = nextSeparator;
      this.rawSource = source;
      this.view.setState(this.createState(source, selection.head));
      return;
    }
    const anchor = Math.min(this.view.state.selection.main.head, this.view.state.doc.length);
    this.view.dispatch({
      changes: { from: 0, to: this.view.state.doc.length, insert: createEditorDocument(source) },
      selection: { anchor: Math.min(anchor, editorLength(source)) },
      annotations: [hostTransaction.of(true), Transaction.addToHistory.of(false)],
    });
    this.rawSource = source;
  }

  public refreshPreview(): void {
    if (this.mode === "live") {
      this.view.dispatch({ effects: refreshLivePreview.of(undefined) });
    }
  }

  public insertWikiLink(target: string): string | undefined {
    if (this.readOnly) return "Resolve the editor conflict before inserting a link.";
    const selection = this.view.state.selection.main;
    const plan = planWikiLinkInsertion(target, this.view.state.sliceDoc(selection.from, selection.to));
    if ("error" in plan) return plan.error;
    const anchor = selection.from + plan.source.length;
    this.view.dispatch({
      changes: { from: selection.from, to: selection.to, insert: plan.source },
      selection: { anchor },
      userEvent: "input",
      scrollIntoView: true,
    });
    this.view.focus();
    return undefined;
  }

  /**
   * Applies a frontmatter edit planned against the document's current raw text.
   *
   * The planner runs on the same snapshot the offsets are mapped against, so a keystroke
   * landing between planning and applying cannot shift the edit onto the wrong characters.
   * `source` deliberately is not used here: it holds the last host-synced text, which lags
   * the live document whenever the user has typed since the last acknowledgement.
   */
  public applyMetadataEdit(
    plan: (source: string) => OffsetTextEdit | undefined,
  ): { readonly applied: boolean; readonly reason?: string } {
    if (this.readOnly) {
      return { applied: false, reason: "Resolve the editor conflict before editing tags." };
    }
    const live = serializeEditorDocument(this.view.state.doc, this.lineSeparator);
    const edit = plan(live);
    if (edit === undefined) return { applied: false };
    this.view.dispatch({
      changes: {
        from: rawOffsetToEditorOffset(live, edit.start),
        to: rawOffsetToEditorOffset(live, edit.end),
        // The document is newline-normalised; the patch layer restores the file's endings.
        insert: normalizeEditorInput(edit.text),
      },
      userEvent: "input",
      scrollIntoView: false,
    });
    return { applied: true };
  }

  public reveal(rawOffset: number): void {
    const position = Math.min(
      rawOffsetToEditorOffset(this.source, rawOffset),
      this.view.state.doc.length,
    );
    this.view.dispatch({
      selection: { anchor: position },
      effects: [
        revealLiveLine.of(position),
        EditorView.scrollIntoView(position, { y: "center" }),
      ],
    });
    this.view.focus();
    if (this.revealTimer !== undefined) window.clearTimeout(this.revealTimer);
    this.revealTimer = window.setTimeout(() => {
      this.view.dispatch({ effects: revealLiveLine.of(undefined) });
      this.revealTimer = undefined;
    }, 1_600);
  }

  public focus(): void {
    this.view.focus();
  }

  public destroy(): void {
    if (this.revealTimer !== undefined) window.clearTimeout(this.revealTimer);
    this.view.destroy();
  }

  private createState(source: string, anchor = 0): EditorState {
    return EditorState.create({
      doc: createEditorDocument(source),
      selection: { anchor: Math.min(anchor, editorLength(source)) },
      extensions: this.extensions(),
    });
  }

  private extensions(): Extension {
    const completionSource = createWikiCompletionSource(this.dependencies.suggestions);
    return [
      EditorState.allowMultipleSelections.of(true),
      EditorView.cspNonce.of(this.cspNonce),
      EditorView.clipboardInputFilter.of(normalizeEditorInput),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({
        "aria-label": "Markdown note editor",
        "aria-describedby": "editor-hint sync-status",
        spellcheck: "true",
      }),
      markdown({ base: markdownLanguage, completeHTMLTags: false, codeLanguages: [...codeLanguages] }),
      markdownContext,
      history(),
      closeBrackets(),
      bracketMatching(),
      drawSelection(),
      dropCursor(),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      highlightSpecialChars(),
      highlightSelectionMatches(),
      autocompletion({ override: [completionSource], defaultKeymap: false, activateOnTyping: true }),
      Prec.highest(keymap.of([
        ...completionKeymap,
        { key: "Mod-s", preventDefault: true, run: () => this.requestSave() },
        { key: "Mod-Enter", preventDefault: true, run: () => this.openLinkAtCursor() },
      ])),
      keymap.of([
        ...closeBracketsKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...defaultKeymap,
        indentWithTab,
      ]),
      placeholder("Start writing your note…"),
      this.previewCompartment.of(this.mode === "live" ? this.previewExtension : []),
      this.readOnlyCompartment.of(readOnlyExtensions(this.readOnly)),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged || update.transactions.some((item) => item.annotation(hostTransaction))) {
          return;
        }
        const result = createEditorPatch(
          update.changes,
          update.state.doc,
          this.rawSource,
          this.lineSeparator,
        );
        if (result === undefined) return;
        this.rawSource = result.source;
        this.dependencies.sourcePatched(result.patch);
      }),
      vispEditorTheme,
    ];
  }

  private requestSave(): boolean {
    this.dependencies.saveRequested();
    return true;
  }

  private openLinkAtCursor(): boolean {
    const position = this.view.state.selection.main.head;
    const line = this.view.state.doc.lineAt(position);
    const link = findWikiLinkAtPosition(line.text, position - line.from);
    if (link === undefined) return false;
    if (!isRecognizedWikiLink(this.view.state, line.from + link.from, line.from + link.to)) {
      return false;
    }
    this.dependencies.openLink(link.target, false);
    return true;
  }
}

function readOnlyExtensions(readOnly: boolean): Extension {
  return [
    EditorState.readOnly.of(readOnly),
    EditorView.contentAttributes.of({ "aria-readonly": String(readOnly) }),
  ];
}

function editorLength(source: string): number {
  return rawOffsetToEditorOffset(source, source.length);
}
