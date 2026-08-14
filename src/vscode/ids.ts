import type { EditorInlineMark } from "../domain/protocol";

export const NOTE_EDITOR_VIEW_TYPE = "vispNotes.noteEditor";

export const COMMAND_IDS = {
  newNote: "vispNotes.newNote",
  createMissingNote: "vispNotes.createMissingNote",
  newTask: "vispNotes.newTask",
  toggleTask: "vispNotes.toggleTask",
  insertLink: "vispNotes.insertLink",
  showBacklinks: "vispNotes.showBacklinks",
  openLocalGraph: "vispNotes.openLocalGraph",
  openWorkspaceGraph: "vispNotes.openWorkspaceGraph",
  toggleRenderedSource: "vispNotes.toggleRenderedSource",
  renameNote: "vispNotes.renameNote",
  deleteNote: "vispNotes.deleteNote",
  findBrokenLinks: "vispNotes.findBrokenLinks",
  rebuildIndex: "vispNotes.rebuildIndex",
  openTasks: "vispNotes.openTasks",
  openTodayTasks: "vispNotes.openTodayTasks",
  search: "vispNotes.search",
  openNote: "vispNotes.openNote",
  addTag: "vispNotes.addTag",
  removeTag: "vispNotes.removeTag",
  useAsDefaultEditor: "vispNotes.useAsDefaultEditor",
  useTextEditorByDefault: "vispNotes.useTextEditorByDefault",
  toggleBold: "vispNotes.toggleBold",
  toggleItalic: "vispNotes.toggleItalic",
  toggleInlineCode: "vispNotes.toggleInlineCode",
  toggleStrikethrough: "vispNotes.toggleStrikethrough",
} as const;

export const CONTRIBUTED_COMMAND_IDS = Object.freeze(Object.values(COMMAND_IDS));

/**
 * The command each inline mark is contributed under.
 *
 * These four exist to be bound. The note editor is a webview and writes its own bold, but VS
 * Code resolves the keydown as well — Ctrl+B, Ctrl+E and Ctrl+Shift+X each ran a workbench
 * command on top of the toggle, and Ctrl+E took the keyboard away to Quick Open mid-sentence.
 * A key is only shadowed by another binding, and a binding is only real if its command is
 * registered, so each of these is a registered command that routes the mark to the focused
 * note editor the way Insert Link and Add Tag already do.
 *
 * They are worth having in the palette on their own account: a webview's keymap appears in no
 * Keyboard Shortcuts list, so until these existed the only place these four keys were written
 * down in the product was the note menu's hint column.
 */
export const INLINE_FORMAT_COMMANDS: Readonly<Record<EditorInlineMark, string>> = Object.freeze({
  bold: COMMAND_IDS.toggleBold,
  italic: COMMAND_IDS.toggleItalic,
  "inline-code": COMMAND_IDS.toggleInlineCode,
  strikethrough: COMMAND_IDS.toggleStrikethrough,
});
