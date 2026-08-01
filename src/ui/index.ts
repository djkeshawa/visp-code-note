export { createEditorHtml } from "./editorPage";
export { createGraphHtml } from "./graphPage";
export { createNotesHtml } from "./notesPage";
export { createTasksHtml } from "./tasksPage";
export type { WebviewTemplateOptions } from "./webviewPage";

export type {
  EditorToHostMessage,
  HostToNotesMessage,
  NotesToHostMessage,
  GraphToHostMessage,
  HostToEditorMessage,
  HostToGraphMessage,
  HostToTasksMessage,
  TasksToHostMessage,
} from "../domain/protocol";
export { createWorkspaceHtml } from "./workspacePage";
