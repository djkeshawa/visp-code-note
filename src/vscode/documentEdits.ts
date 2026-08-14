import * as vscode from "vscode";
import type { OffsetRange } from "../domain/models";
import type { LinkReplacement } from "../application/linkMigration";
import { groupLinkReplacements } from "../application/linkMigration";
import type { OffsetTextEdit } from "../application/textEdits";
import { mapConcurrent } from "../indexing/concurrency";

export function toRange(document: vscode.TextDocument, range: OffsetRange): vscode.Range {
  return new vscode.Range(document.positionAt(range.start), document.positionAt(range.end));
}

/** A document a link migration is going to touch, with the text the plan was made against. */
export interface PlannedDocument {
  readonly document: vscode.TextDocument;
  readonly source: string;
  readonly edits: OffsetTextEdit[];
}

export async function loadPlannedDocument(
  documents: Map<string, PlannedDocument>,
  uri: string,
): Promise<PlannedDocument> {
  const existing = documents.get(uri);
  if (existing) return existing;
  const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(uri));
  const planned: PlannedDocument = { document, source: document.getText(), edits: [] };
  documents.set(uri, planned);
  return planned;
}

/**
 * How many documents are opened at once. The same 16 `WorkspaceIndex.rebuild` reads the whole
 * vault at, and the same one `applyValidatedContentEdit` reopens the planned set at.
 */
const OPEN_CONCURRENCY = 16;

/**
 * Opens every document a link migration touches and refuses the whole plan if one of the links
 * is no longer where the plan says it is.
 *
 * Checking the text under each range rather than a file timestamp is what lets an unrelated edit
 * to the same file pass — the index is read on a debounce, so a note is very often a keystroke
 * ahead of the plan without any of its links having moved.
 *
 * All at once, sixteen deep, because one of the two callers is a rename participant running
 * under `files.participants.timeout` with the Explorer frozen behind it. A popular note with
 * 2,000 mentions meant 2,000 sequential `openTextDocument` round trips, and on a remote or WSL
 * workspace each of those is a message across a link rather than a local read: modelled at one
 * millisecond a document, 2,000 files took 2,170ms in a row and 141ms sixteen at a time. The
 * sequential figure is not merely slow — past the timeout VS Code drops the contributed edit
 * with nothing on screen, which loses the one promise this handler exists to keep.
 *
 * The checking stays in one pass afterwards, in the order the links were grouped, so which file
 * a stale plan names does not depend on which read happened to finish first. That costs the
 * opens of a plan already doomed, which is a rename that is about to be told to retry anyway.
 */
export async function planReplacementDocuments(
  replacements: readonly LinkReplacement[],
): Promise<Map<string, PlannedDocument>> {
  const groups = [...groupLinkReplacements(replacements)];
  const opened = await mapConcurrent(groups, OPEN_CONCURRENCY, async ([uri]) =>
    vscode.workspace.openTextDocument(vscode.Uri.parse(uri)));
  const documents = new Map<string, PlannedDocument>();
  for (const [index, [uri, items]] of groups.entries()) {
    const document = opened[index] as vscode.TextDocument;
    const planned: PlannedDocument = { document, source: document.getText(), edits: [] };
    documents.set(uri, planned);
    for (const item of items) {
      if (planned.source.slice(item.range.start, item.range.end) !== item.expectedText) {
        throw new Error(`A link in ${planned.document.uri.fsPath} changed. Rebuild the index and retry.`);
      }
      planned.edits.push({ ...item.range, text: item.text });
    }
  }
  return documents;
}

/** The workspace edit that rewrites a planned set of links, in place, where they are today. */
export async function planLinkReplacementEdit(
  replacements: readonly LinkReplacement[],
): Promise<vscode.WorkspaceEdit> {
  const documents = await planReplacementDocuments(replacements);
  const edit = new vscode.WorkspaceEdit();
  for (const planned of documents.values()) {
    for (const item of planned.edits) {
      edit.replace(planned.document.uri, toRange(planned.document, item), item.text);
    }
  }
  return edit;
}

export async function revealOffset(uri: vscode.Uri, offset: number): Promise<void> {
  const document = await vscode.workspace.openTextDocument(uri);
  const position = document.positionAt(Math.min(Math.max(offset, 0), document.getText().length));
  const editor = await vscode.window.showTextDocument(document, { preview: false });
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}
