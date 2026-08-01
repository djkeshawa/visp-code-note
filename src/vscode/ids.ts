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
} as const;

export const CONTRIBUTED_COMMAND_IDS = Object.freeze(Object.values(COMMAND_IDS));
