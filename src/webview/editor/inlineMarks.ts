/**
 * The four inline marks, and the keys that write them.
 *
 * Three things have to agree about these: the keymap that runs them, the `/` menu that names
 * them, and the overflow menu's hint column. That column is not decoration — a webview's keys
 * are never contributed to VS Code, so they appear in no Keyboard Shortcuts list and can be
 * found nowhere else in the product. A key declared in one place and advertised in another
 * drifts silently, which is how Insert Link came to advertise a key it had already been moved
 * off. One table, read by all three.
 *
 * No `@codemirror` import here, so the table and its key labels are testable without an editor.
 */

export type InlineMarkId = "bold" | "italic" | "inline-code" | "strikethrough";

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
 */
export function keyHint(key: string, mac: boolean): string {
  const parts = key.split("-");
  const last = parts[parts.length - 1] ?? "";
  const modifiers = parts.slice(0, -1);
  const symbol: Readonly<Record<string, string>> = mac
    ? { Mod: "⌘", Shift: "⇧", Alt: "⌥", Ctrl: "⌃" }
    : { Mod: "Ctrl", Shift: "Shift", Alt: "Alt", Ctrl: "Ctrl" };
  const named = modifiers.map((modifier) => symbol[modifier] ?? modifier);
  const label = last.length === 1 ? last.toLocaleUpperCase() : last;
  return mac ? [...named, label].join("") : [...named, label].join("+");
}
