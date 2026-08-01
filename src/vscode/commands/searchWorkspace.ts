import * as vscode from "vscode";
import {
  buildWorkspaceSearchResults,
  type WorkspaceSearchField,
  type WorkspaceSearchResult,
} from "../../application/workspaceSearch";
import { revealOffset } from "../documentEdits";
import type { CommandIndex } from "./contracts";

interface SearchQuickPickItem extends vscode.QuickPickItem {
  readonly result: WorkspaceSearchResult;
}

/**
 * Opens the workspace search, optionally on a query.
 *
 * The query matters: the workspace panel's tag chips open this on the tag they name. Without
 * it, clicking a chip showed an arbitrary slice of the whole workspace and the reader had to
 * retype what they had just clicked.
 */
export async function searchWorkspace(
  index: CommandIndex,
  initialQuery?: string,
): Promise<void> {
  const picker = vscode.window.createQuickPick<SearchQuickPickItem>();
  picker.title = "Search Visp Notes";
  picker.placeholder = "Search titles, paths, aliases, tags, note text, and tasks";
  picker.matchOnDescription = true;
  picker.matchOnDetail = true;
  if (initialQuery !== undefined && initialQuery.length > 0) {
    picker.value = initialQuery;
  }

  const updateItems = (): void => {
    picker.items = buildWorkspaceSearchResults(index.snapshot, picker.value).map(toQuickPickItem);
  };
  updateItems();

  let selected: WorkspaceSearchResult | undefined;
  try {
    selected = await waitForSelection(picker, updateItems);
  } finally {
    picker.dispose();
  }
  if (selected !== undefined) {
    await revealOffset(vscode.Uri.parse(selected.noteUri), selected.offset);
  }
}

function waitForSelection(
  picker: vscode.QuickPick<SearchQuickPickItem>,
  updateItems: () => void,
): Promise<WorkspaceSearchResult | undefined> {
  return new Promise((resolve) => {
    let settled = false;
    let subscriptions: vscode.Disposable[] = [];
    const finish = (result: WorkspaceSearchResult | undefined): void => {
      if (settled) return;
      settled = true;
      vscode.Disposable.from(...subscriptions).dispose();
      resolve(result);
    };
    subscriptions = [
      picker.onDidChangeValue(updateItems),
      picker.onDidAccept(() => {
        finish(picker.activeItems[0]?.result);
        picker.hide();
      }),
      picker.onDidHide(() => finish(undefined)),
    ];
    picker.show();
  });
}

function toQuickPickItem(result: WorkspaceSearchResult): SearchQuickPickItem {
  const icon = result.kind === "note"
    ? "$(note)"
    : result.completed === true ? "$(pass-filled)" : "$(circle-outline)";
  return {
    label: `${icon} ${result.displayText}`,
    description: result.notePath,
    detail: `${fieldLabel(result.matchedField)} · ${result.preview}`,
    alwaysShow: true,
    result,
  };
}

function fieldLabel(field: WorkspaceSearchField): string {
  switch (field) {
    case "title": return "Title";
    case "path": return "Path";
    case "alias": return "Alias";
    case "tag": return "Tag";
    case "body": return "Note text";
    case "task": return "Task";
  }
}
