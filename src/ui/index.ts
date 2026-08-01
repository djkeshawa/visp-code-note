export { createEditorHtml } from "./editorPage";
export { createGraphHtml } from "./graphPage";
export { createTasksHtml } from "./tasksPage";
export type { WebviewTemplateOptions } from "./webviewPage";

export type {
  EditorToHostMessage,
  GraphToHostMessage,
  HostToEditorMessage,
  HostToGraphMessage,
  HostToTasksMessage,
  TasksToHostMessage,
} from "../domain/protocol";
export { createWorkspaceHtml } from "./workspacePage";
