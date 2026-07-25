import type { Command } from "vscode";
import { COMMAND_IDS, NOTE_EDITOR_VIEW_TYPE } from "../ids";

export type SmartViewId = "tasks" | "due" | "graph" | "broken" | "orphans";

export function openRenderedNoteCommand(uri: unknown): Command {
  return {
    command: "vscode.openWith",
    title: "Open Note",
    arguments: [uri, NOTE_EDITOR_VIEW_TYPE, { preview: false }],
  };
}

export function smartViewCommand(id: SmartViewId): Command | undefined {
  switch (id) {
    case "tasks":
      return { command: COMMAND_IDS.openTasks, title: "Open Tasks" };
    case "due":
      return { command: COMMAND_IDS.openTodayTasks, title: "Open Due Today" };
    case "graph":
      return { command: COMMAND_IDS.openWorkspaceGraph, title: "Open Knowledge Graph" };
    case "broken":
      return { command: COMMAND_IDS.findBrokenLinks, title: "Find Broken Links" };
    case "orphans":
      return undefined;
  }
}
