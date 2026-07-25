export { createBacklinksHtml } from "./backlinksPage";
export { createEditorHtml } from "./editorPage";
export { createGraphHtml } from "./graphPage";
export { createTasksHtml } from "./tasksPage";
export type { WebviewTemplateOptions } from "./webviewPage";

export type {
  BacklinksState,
  BacklinksToHostMessage,
  EditorToHostMessage,
  GraphToHostMessage,
  HostToBacklinksMessage,
  HostToEditorMessage,
  HostToGraphMessage,
  HostToTasksMessage,
  TasksToHostMessage,
} from "../domain/protocol";
