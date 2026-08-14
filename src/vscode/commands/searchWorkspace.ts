import * as vscode from "vscode";
import {
  buildWorkspaceSearchPage,
  type WorkspaceSearchField,
  type WorkspaceSearchPage,
  type WorkspaceSearchResult,
} from "../../application/workspaceSearch";
import { warmWorkspaceSearchIndex } from "../../application/workspaceSearchIndex";
import { revealOffset } from "../documentEdits";
import type { CommandIndex } from "./contracts";

interface SearchQuickPickItem extends vscode.QuickPickItem {
  readonly result: WorkspaceSearchResult;
}

const PICKER_TITLE = "Search Visp Notes";

/**
 * How long the picker lets typing settle before it scans.
 *
 * A scan reads every note the query can reach, and the opening characters of a query reach
 * nearly all of them — measured at 11ms per keystroke over a 2,000-note vault of ordinary
 * prose, 24ms where the notes share vocabulary, against 0.4ms once the query is specific
 * enough to narrow. That cost lands on the extension host on every character, which is
 * where the reader is guaranteed to be. Waiting spends one scan on a burst of typing
 * instead of one per character. The workspace panel's filter waits for the same reason.
 */
const SCAN_DEBOUNCE_MS = 100;

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
  picker.title = PICKER_TITLE;
  picker.placeholder = "Search titles, paths, aliases, tags, note text, and tasks";
  picker.matchOnDescription = true;
  picker.matchOnDetail = true;
  if (initialQuery !== undefined && initialQuery.length > 0) {
    picker.value = initialQuery;
  }

  let scanTimer: ReturnType<typeof setTimeout> | undefined;
  const scan = (): void => {
    const page = buildWorkspaceSearchPage(index.snapshot, picker.value);
    picker.items = page.results.map(toQuickPickItem);
    picker.title = pageTitle(page);
    picker.busy = false;
  };
  /*
   * `busy` from the keystroke until the scan lands, so the rows on screen are visibly the
   * previous query's rather than an answer to what has just been typed.
   */
  const scanWhenTypingSettles = (): void => {
    picker.busy = true;
    if (scanTimer !== undefined) {
      clearTimeout(scanTimer);
    }
    scanTimer = setTimeout(() => {
      scanTimer = undefined;
      scan();
    }, SCAN_DEBOUNCE_MS);
  };
  // The first list is not typing: nobody is mid-word, and the reader is waiting on it.
  scan();
  /*
   * The narrowing index is built lazily on the first multi-character query, which in a large
   * workspace would land that one-time cost on a keystroke. Building it here, queued behind
   * the picker's initial render, spends the user's first moments of typing instead.
   */
  setTimeout(() => warmWorkspaceSearchIndex(index.snapshot.notes), 0);

  let selected: WorkspaceSearchResult | undefined;
  try {
    selected = await waitForSelection(picker, scanWhenTypingSettles);
  } finally {
    if (scanTimer !== undefined) {
      clearTimeout(scanTimer);
    }
    picker.dispose();
  }
  if (selected !== undefined) {
    await revealOffset(vscode.Uri.parse(selected.noteUri), selected.offset);
  }
}

/**
 * Says how much of the answer is on screen when the list is cut off at the limit.
 *
 * Without it, "your note is match 340 of 1,284" and "there is no such note" are the same
 * picture, and the reader retypes a query that was already right.
 */
function pageTitle(page: WorkspaceSearchPage): string {
  return page.matched <= page.results.length
    ? PICKER_TITLE
    : `${PICKER_TITLE} — showing ${page.results.length.toLocaleString()} of ` +
      `${page.matched.toLocaleString()} matches`;
}

function waitForSelection(
  picker: vscode.QuickPick<SearchQuickPickItem>,
  onValueChanged: () => void,
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
      picker.onDidChangeValue(onValueChanged),
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
