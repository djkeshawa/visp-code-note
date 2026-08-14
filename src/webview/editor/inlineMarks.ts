/**
 * The four inline marks, and the keys that write them.
 *
 * Four things have to agree about these: the keymap that runs them, the `/` menu that names
 * them, the overflow menu's hint column, and — since the collision fix — the four keybindings
 * the manifest contributes to shadow VS Code's own defaults inside this editor. That hint
 * column was the only place a reader could find these keys while a webview keymap was the
 * whole story; now they are in the Keyboard Shortcuts list too, which is where a reader looks
 * first. A key declared in one place and advertised in another drifts silently, which is how
 * Insert Link came to advertise a key it had already been moved off. One table, read by all
 * four — `keybindingConflicts.test.ts` is where the manifest half of that is held to it.
 *
 * No `@codemirror` import here, so the table and its key labels are testable without an editor.
 */
import type { EditorInlineMarkWire } from "../contracts.js";

export type InlineMarkId = EditorInlineMarkWire;

export interface InlineMark {
  readonly id: InlineMarkId;
  readonly label: string;
  /** Written before the marked text. */
  readonly open: string;
  /** Written after it. Kept apart from `open` so the primitive never assumes they match. */
  readonly close: string;
  /**
   * The parse-tree nodes that already carry this mark. A second press removes them, which is
   * the half of a toggle Live mode makes indispensable: an inactive line hides every mark, so
   * the asterisks a reader would have to select and delete by hand are not on the screen.
   */
  readonly nodes: readonly string[];
  /** CodeMirror key notation. `Mod-` is Ctrl everywhere but macOS, where it is Cmd. */
  readonly key: string;
  /** A codicon name, without the `codicon-` prefix. */
  readonly icon: string;
  /** Extra words the `/` menu should match on, beyond the label. */
  readonly keywords: readonly string[];
}

/*
 * Why these keys, having checked each against every table that already owns one:
 *
 *   Mod-b        free in closeBrackets, completion, history, search and the Markdown keymap.
 *   Mod-i        defaultKeymap spends it on selectParentSyntax. Taken deliberately from the
 *                Prec.highest keymap, so exactly one command runs rather than two; the
 *                toggle returns false wherever it declines, and selectParentSyntax still
 *                gets the key there.
 *   Mod-e        free in every composed keymap.
 *   Mod-Shift-x  free. Mod-Shift-b was the obvious pair for bold, and is what
 *                vispNotes.showBacklinks is contributed on with
 *                `activeCustomEditorId == vispNotes.noteEditor` — taking it would have
 *                reproduced the Ctrl+Shift+G defect exactly, one key running two things in
 *                the note editor.
 *
 * Mod-k is not free either: outlineFolding hangs Mod-k Mod-0 and Mod-k Mod-j off it, and a
 * direct binding on a chord prefix swallows the chord.
 *
 * Every table above is a CodeMirror one, and checking only those was the hole. VS Code spends
 * three of these four itself — Ctrl+B is Toggle Primary Side Bar, Ctrl+E is Quick Open, and
 * Ctrl+Shift+X is the Extensions view — and a webview cannot decline a key on the workbench's
 * behalf: the shim forwards every keydown out to VS Code for keybinding resolution whether the
 * page consumed it or not, so `preventDefault` here stops nothing out there. Ctrl+E was the one
 * that made it unusable, handing the keyboard to Quick Open in the middle of a sentence. The
 * only thing that shadows a default is another binding, so the manifest contributes all four
 * scoped to this editor; `toggleInlineMark` is where the two arrivals of one press are settled.
 */
export const INLINE_MARKS: readonly InlineMark[] = Object.freeze([
  {
    id: "bold",
    label: "Bold",
    open: "**",
    close: "**",
    nodes: ["StrongEmphasis"],
    key: "Mod-b",
    icon: "bold",
    keywords: ["strong", "b"],
  },
  {
    id: "italic",
    label: "Italic",
    open: "*",
    close: "*",
    nodes: ["Emphasis"],
    key: "Mod-i",
    icon: "italic",
    keywords: ["emphasis", "em", "i"],
  },
  {
    id: "inline-code",
    label: "Inline Code",
    open: "`",
    close: "`",
    nodes: ["InlineCode"],
    key: "Mod-e",
    icon: "code",
    keywords: ["monospace", "literal", "backtick"],
  },
  {
    id: "strikethrough",
    label: "Strikethrough",
    open: "~~",
    close: "~~",
    nodes: ["Strikethrough"],
    key: "Mod-Shift-x",
    icon: "dash",
    keywords: ["strike", "struck", "delete", "crossed"],
  },
]);

/**
 * A key in the notation the reader's own keyboard uses.
 *
 * "Ctrl/Cmd+Shift+X" names both platforms at once and runs to three times the width the hint
 * column is given, so the menu says only the one the reader is on.
 *
 * On a Mac the glyphs are ordered ⌃⌥⇧⌘ however the binding was written, because that is the
 * order every other menu on the machine uses and a reader matches the shape before reading it.
 * Windows and Linux keep the order the binding declares.
 */
const MAC_MODIFIER_ORDER: readonly string[] = ["Ctrl", "Alt", "Shift", "Mod"];

export function keyHint(key: string, mac: boolean): string {
  const parts = key.split("-");
  const last = parts[parts.length - 1] ?? "";
  const declared = parts.slice(0, -1);
  const symbol: Readonly<Record<string, string>> = mac
    ? { Mod: "⌘", Shift: "⇧", Alt: "⌥", Ctrl: "⌃" }
    : { Mod: "Ctrl", Shift: "Shift", Alt: "Alt", Ctrl: "Ctrl" };
  const modifiers = mac
    ? [...declared].sort(
        (a, b) => MAC_MODIFIER_ORDER.indexOf(a) - MAC_MODIFIER_ORDER.indexOf(b),
      )
    : declared;
  const named = modifiers.map((modifier) => symbol[modifier] ?? modifier);
  const label = last.length === 1 ? last.toLocaleUpperCase() : last;
  return mac ? [...named, label].join("") : [...named, label].join("+");
}
