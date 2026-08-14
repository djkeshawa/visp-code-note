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
import { outlineFolding } from "./outlineFolding.js";
import {
  createEditorDocument,
  normalizeEditorInput,
  serializeEditorDocument,
} from "./editorDocument.js";
import { createEditorPatch } from "./editorPatch.js";
import { hostSourceChange } from "./hostSourceChange.js";
import { inlineFormattingKeymap, toggleWrap } from "./inlineFormatting.js";
import { INLINE_MARKS } from "./inlineMarks.js";
import type { InlineMarkId } from "./inlineMarks.js";
import { createSpellCheck, setSpellDictionary } from "./spellCheck.js";
import { createSpellDictionary, parseDictionary } from "../../application/spellDictionary.js";
import { createLivePreview, refreshLivePreview, revealLiveLine } from "./livePreview.js";
import { isRecognizedWikiLink, markdownContext } from "./markdownContext.js";
import { detectLineSeparator, rawOffsetToEditorOffset } from "./offsetMapping.js";
import type { LineSeparator } from "./offsetMapping.js";
import { createWikiCompletionSource } from "./wikiCompletion.js";
import { createSlashCompletionSource } from "./slashCompletion.js";
import { createTagCompletionSource, TAG_COMPLETION_TYPE } from "./tagCompletion.js";
import { tagHueColor } from "../../application/tagHue.js";
import { wikiCompletionFooter, wikiFooterApplies } from "./wikiCompletionFooter.js";
import { planWikiLinkInsertion } from "./wikiLinkInsertion.js";
import { findWikiLinkAtPosition } from "./wikiLinkNavigation.js";
import type { TextPatch } from "../../application/textPatch.js";

export type MarkdownEditorMode = "live" | "markdown";

export interface CodeMirrorEditorDependencies {
  readonly suggestions: () => readonly NoteSuggestionWire[];
  /** Every tag in the workspace, most used first, so `#` can offer what already exists. */
  readonly workspaceTags: () => readonly string[];
  readonly unresolvedLinks: () => ReadonlySet<string>;
  readonly sourcePatched: (patch: TextPatch) => void;
  readonly saveRequested: () => void;
  readonly openLink: (target: string, beside: boolean) => void;
  readonly openExternal: (url: string) => void;
  readonly noteTitle: () => string;
  /** Words the reader has accepted, remembered by the host. */
  readonly addDictionaryWord?: (word: string) => void;
}

/** The design gives a note, a heading and a block their own glyph in their own hue. */
const WIKI_COMPLETION_ICONS: Readonly<Record<string, string>> = {
  reference: "note",
  property: "symbol-numeric",
  constant: "symbol-field",
};

/**
 * Slash commands each want their own glyph, and `Completion` has no slot for one — so the
 * codicon rides in `type`, which is a free-form string CodeMirror only uses to build a class
 * name. Prefixed so a block command can never be mistaken for a wiki-link kind.
 */
const SLASH_TYPE_PREFIX = "visp-";

function completionIcon(type: string): { readonly codicon: string; readonly tone: string } {
  return type.startsWith(SLASH_TYPE_PREFIX)
    ? { codicon: type.slice(SLASH_TYPE_PREFIX.length), tone: "command" }
    : { codicon: WIKI_COMPLETION_ICONS[type] ?? "note", tone: type === "" ? "reference" : type };
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
  private dictionaryWords: readonly string[] = [];
  private readonly personalWords = new Set<string>();
  /*
   * Off until the host says otherwise. The setting arrives with the first state message,
   * which is after this object exists, so starting hopefully and correcting later would
   * already have fetched the word list a reader who turned spelling off never wanted.
   */
  private spellingEnabled = false;

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
      openExternal: dependencies.openExternal,
      noteTitle: dependencies.noteTitle,
    });
    this.host.classList.add("is-live-mode");
    this.view = new EditorView({
      parent: host,
      state: this.createState(source),
    });
  }

  /**
   * Fetches the bundled word list.
   *
   * The URL is put on the body by the page, because a webview URI is minted per session and
   * cannot be constructed from inside the page. Deliberately not awaited by the constructor: the note is readable long
   * before 672KB of dictionary has been read, and spelling simply appears when it lands.
   */
  private async loadDictionary(): Promise<void> {
    // Nothing is fetched at all when spelling is off — 672KB not read rather than read and ignored.
    if (!this.spellingEnabled || this.dictionaryWords.length > 0) return;
    try {
      const url = document.body.dataset.dictionary;
      if (url === undefined || url.length === 0) return;
      const response = await fetch(url);
      if (!response.ok) return;
      this.dictionaryWords = parseDictionary(await response.text());
      this.publishDictionary();
    } catch {
      // A missing dictionary means no spelling, which is not worth interrupting the reader for.
    }
  }

  private publishDictionary(): void {
    if (!this.spellingEnabled) {
      this.view.dispatch({ effects: setSpellDictionary.of(undefined) });
      return;
    }
    if (this.dictionaryWords.length === 0) return;
    this.view.dispatch({
      effects: setSpellDictionary.of(
        createSpellDictionary(this.dictionaryWords, this.personalWords),
      ),
    });
  }

  /**
   * Turns spelling on or off without reopening the note. Switching it on for the first time
   * fetches the word list then, rather than at startup for a reader who never wants it.
   */
  public setSpellingEnabled(enabled: boolean): void {
    if (enabled === this.spellingEnabled) return;
    this.spellingEnabled = enabled;
    if (enabled) void this.loadDictionary();
    this.publishDictionary();
  }

  /** Remembers a word the reader accepted, and tells the host so it outlives this panel. */
  public acceptWord(word: string): void {
    const normalized = word.trim().toLowerCase();
    if (normalized.length === 0 || this.personalWords.has(normalized)) return;
    this.personalWords.add(normalized);
    this.publishDictionary();
    this.dependencies.addDictionaryWord?.(normalized);
  }

  /** Words the host remembered from earlier sessions. */
  public setPersonalWords(words: Iterable<string>): void {
    for (const word of words) {
      const normalized = word.trim().toLowerCase();
      if (normalized.length > 0) this.personalWords.add(normalized);
    }
    this.publishDictionary();
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
    /*
     * Only the span that differs. A whole-document replacement reached the same text but took
     * the reader's undo history with it — see `hostSourceChange`.
     */
    const changes = hostSourceChange(
      this.view.state.doc.toString(),
      normalizeEditorInput(source),
    );
    if (changes === undefined) {
      this.rawSource = source;
      return;
    }
    this.view.dispatch({
      changes,
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
   * Toggles an inline mark asked for from outside the page — a contributed keybinding, or the
   * command palette. Returns whether anything was written.
   *
   * The guard is the whole of it. VS Code forwards every keydown out of a webview to the
   * workbench for keybinding resolution, and it does not care that this page already consumed
   * the key: one Ctrl+B arrives twice, once through the keymap above and once through the
   * binding that exists to keep Toggle Primary Side Bar off it. Applying both would toggle the
   * bold on and straight back off, and leave two undo steps behind one keystroke — so the press
   * that reached the keymap is recognised by the only thing that distinguishes it, which is
   * that the text area still holds focus, and this arrival declines.
   *
   * The other refusal is the one that matters more. `activeCustomEditorId` says which editor is
   * *active*, not which widget has focus, so this binding also fires for a Ctrl+B pressed in the
   * Explorer or the terminal while a note is the active tab. There is no `when` clause that can
   * tell those apart. Requiring focus to be somewhere in this page means the worst that key can
   * now do is nothing, rather than silently formatting a note the reader is not looking at.
   */
  public toggleInlineMark(id: InlineMarkId): boolean {
    if (!this.view.dom.ownerDocument.hasFocus() || this.view.hasFocus) return false;
    const mark = INLINE_MARKS.find((entry) => entry.id === id);
    if (mark === undefined) return false;
    return toggleWrap(this.view, mark.open, mark.close);
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
      return { applied: false, reason: "Resolve the editor conflict before editing this note." };
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
    const slashSource = createSlashCompletionSource();
    const tagSource = createTagCompletionSource(this.dependencies.workspaceTags);
    return [
      EditorState.allowMultipleSelections.of(true),
      EditorView.cspNonce.of(this.cspNonce),
      EditorView.clipboardInputFilter.of(normalizeEditorInput),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({
        "aria-label": "Markdown note editor",
        "aria-describedby": "sync-status",
        spellcheck: "true",
      }),
      markdown({ base: markdownLanguage, completeHTMLTags: false, codeLanguages: [...codeLanguages] }),
      outlineFolding,
      markdownContext,
      createSpellCheck({ addWord: (word) => this.acceptWord(word) }),
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
      /*
       * Three sources share this popup: wiki links after `[[`, block commands after `/`, and
       * tags after `#`. They render identically — icon, label, right-aligned syntax — but only
       * the wiki one gets the footer naming the three suffixes a link accepts, so the tooltip
       * carries a second class saying which it currently is. The tests here are the ones the
       * sources themselves apply, so the two cannot disagree about which menu is open.
       *
       * `icons: false` turns off CodeMirror's own glyph column, which has no rule for the
       * types these sources emit and so drew an empty box beside every row. The design's
       * codicons are added instead, and the detail is given its own right-aligned column
       * rather than trailing the label as free text.
       */
      autocompletion({
        override: [completionSource, slashSource, tagSource],
        defaultKeymap: false,
        activateOnTyping: true,
        icons: false,
        tooltipClass: (state) => wikiFooterApplies(state)
          ? "wiki-completion-tooltip"
          : "wiki-completion-tooltip is-slash",
        addToOptions: [
          {
            position: 15,
            render: (completion) => {
              const type = completion.type ?? "";
              /*
               * A tag is drawn as its own colour rather than as a glyph. The hue is what the
               * reader will see on the chip, in the panel and on the graph node, so showing it
               * here is what lets them recognise the tag before committing to the name.
               */
              if (type.startsWith(TAG_COMPLETION_TYPE)) {
                const dot = document.createElement("span");
                dot.className = "wiki-completion-icon tag-dot";
                dot.style.setProperty(
                  "--tag-hue",
                  tagHueColor(type.slice(TAG_COMPLETION_TYPE.length)),
                );
                dot.setAttribute("aria-hidden", "true");
                return dot;
              }
              const icon = document.createElement("span");
              const { codicon, tone } = completionIcon(type);
              icon.className = `wiki-completion-icon codicon codicon-${codicon} is-${tone}`;
              icon.setAttribute("aria-hidden", "true");
              return icon;
            },
          },
          {
            position: 90,
            render: (completion) => {
              if (completion.detail === undefined) return null;
              const path = document.createElement("span");
              path.className = "wiki-completion-path";
              path.textContent = completion.detail;
              return path;
            },
          },
        ],
      }),
      wikiCompletionFooter(),
      Prec.highest(keymap.of([
        ...completionKeymap,
        ...inlineFormattingKeymap,
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
    /*
     * `EditorState.readOnly` is advisory: it is a flag every command is expected to consult,
     * and the Markdown keymap does not consult it. Pressing Enter inside a list therefore
     * still edited a note that had been frozen — which is exactly the note a reader must not
     * be able to change, since freezing it is how a draft conflict is held still until they
     * choose which version wins.
     *
     * The filter is the enforcement rather than the flag. The host may still write, because
     * that is how the conflict is resolved; nothing reaching the document from the keyboard
     * can.
     */
    ...(readOnly
      ? [EditorState.changeFilter.of((transaction) =>
          transaction.annotation(hostTransaction) === true)]
      : []),
  ];
}

function editorLength(source: string): number {
  return rawOffsetToEditorOffset(source, source.length);
}
