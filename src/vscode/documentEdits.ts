import * as vscode from "vscode";
import type { OffsetRange } from "../domain/models";
import type { LinkReplacement } from "../application/linkMigration";
import { groupLinkReplacements } from "../application/linkMigration";
import type { OffsetTextEdit } from "../application/textEdits";

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
 * Opens every document a link migration touches and refuses the whole plan if one of the links
 * is no longer where the plan says it is.
 *
 * Checking the text under each range rather than a file timestamp is what lets an unrelated edit
 * to the same file pass — the index is read on a debounce, so a note is very often a keystroke
 * ahead of the plan without any of its links having moved.
 */
export async function planReplacementDocuments(
  replacements: readonly LinkReplacement[],
): Promise<Map<string, PlannedDocument>> {
  const documents = new Map<string, PlannedDocument>();
  for (const [uri, items] of groupLinkReplacements(replacements)) {
    const planned = await loadPlannedDocument(documents, uri);
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
