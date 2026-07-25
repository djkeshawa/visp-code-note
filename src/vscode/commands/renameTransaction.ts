import * as vscode from "vscode";
import type { LinkReplacement } from "../../application/linkMigration";
import { groupLinkReplacements } from "../../application/linkMigration";
import { planAliasAddition, planTitleChange } from "../../application/noteMetadataEdits";
import { applyTextEdits, type OffsetTextEdit } from "../../application/textEdits";
import type { NoteRecord } from "../../domain/models";
import { mapConcurrent } from "../../indexing/concurrency";
import { toRange } from "../documentEdits";

export type RenameMode = "updateLinks" | "preserveAlias" | "pathOnly";

export interface RenameTransaction {
  readonly initialRenameEdit?: vscode.WorkspaceEdit;
  readonly finalRenameEdit?: vscode.WorkspaceEdit;
  readonly contentEdit: vscode.WorkspaceEdit;
  readonly expectedDocuments: readonly ExpectedDocument[];
  readonly previousUri: vscode.Uri;
  readonly intermediateUri?: vscode.Uri;
  readonly nextUri: vscode.Uri;
  readonly hasContentEdits: boolean;
  readonly before?: string;
  readonly after?: string;
}

interface ExpectedDocument {
  readonly uri: vscode.Uri;
  readonly source: string;
}

interface PlannedDocument {
  readonly document: vscode.TextDocument;
  readonly source: string;
  readonly edits: OffsetTextEdit[];
}

export async function prepareRenameTransaction(
  note: NoteRecord,
  nextUri: vscode.Uri,
  nextTitle: string,
  mode: RenameMode,
  replacements: readonly LinkReplacement[],
  intermediateUri?: vscode.Uri,
): Promise<RenameTransaction> {
  const documents = new Map<string, PlannedDocument>();
  const load = async (uri: string): Promise<PlannedDocument> => {
    const existing = documents.get(uri);
    if (existing) return existing;
    const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(uri));
    const planned = { document, source: document.getText(), edits: [] };
    documents.set(uri, planned);
    return planned;
  };

  for (const [uri, items] of groupLinkReplacements(replacements)) {
    const planned = await load(uri);
    for (const item of items) {
      if (planned.source.slice(item.range.start, item.range.end) !== item.expectedText) {
        throw new Error(`A link in ${planned.document.uri.fsPath} changed. Rebuild the index and retry.`);
      }
      planned.edits.push({ ...item.range, text: item.text });
    }
  }

  if (mode !== "pathOnly") {
    const planned = await load(note.uri);
    const titleEdit = planTitleChange(planned.source, nextTitle);
    if (titleEdit) addMetadataEdit(planned.edits, titleEdit);
    if (mode === "preserveAlias") {
      addMetadataEdit(planned.edits, planAliasAddition(planned.source, note.title));
    }
  }

  const contentEdit = new vscode.WorkspaceEdit();
  const expectedByUri = new Map<string, ExpectedDocument>();
  for (const planned of documents.values()) {
    const targetUri = planned.document.uri.toString() === note.uri ? nextUri : planned.document.uri;
    if (planned.edits.length > 0) {
      expectedByUri.set(targetUri.toString(), { uri: targetUri, source: planned.source });
    }
    for (const item of planned.edits) {
      contentEdit.replace(targetUri, toRange(planned.document, item), item.text);
    }
  }
  const previousUri = vscode.Uri.parse(note.uri);
  let initialRenameEdit: vscode.WorkspaceEdit | undefined;
  if (previousUri.toString() !== nextUri.toString()) {
    initialRenameEdit = new vscode.WorkspaceEdit();
    initialRenameEdit.renameFile(previousUri, intermediateUri ?? nextUri, {
      overwrite: false,
      ignoreIfExists: false,
    });
  }
  let finalRenameEdit: vscode.WorkspaceEdit | undefined;
  if (intermediateUri) {
    finalRenameEdit = new vscode.WorkspaceEdit();
    finalRenameEdit.renameFile(intermediateUri, nextUri, {
      overwrite: false,
      ignoreIfExists: false,
    });
  }

  const changed = [...documents.values()].filter((planned) => planned.edits.length > 0);
  const base = {
    ...(initialRenameEdit ? { initialRenameEdit } : {}),
    ...(finalRenameEdit ? { finalRenameEdit } : {}),
    contentEdit,
    expectedDocuments: [...expectedByUri.values()],
    previousUri,
    ...(intermediateUri ? { intermediateUri } : {}),
    nextUri,
    hasContentEdits: changed.length > 0,
  };
  if (changed.length === 0) return base;
  return {
    ...base,
    before: previewDocument(changed, note.uri, note.path),
    after: previewDocument(
      changed,
      note.uri,
      vscode.workspace.asRelativePath(nextUri, (vscode.workspace.workspaceFolders?.length ?? 0) > 1),
      true,
    ),
  };
}

export async function applyRenameTransaction(transaction: RenameTransaction): Promise<void> {
  let fileRenamed = false;
  if (transaction.initialRenameEdit) {
    if (!(await vscode.workspace.applyEdit(transaction.initialRenameEdit))) {
      throw new Error("VS Code could not rename the note. No Markdown content was changed.");
    }
    fileRenamed = true;
  }

  if (transaction.finalRenameEdit && transaction.intermediateUri) {
    try {
      if (!(await vscode.workspace.applyEdit(transaction.finalRenameEdit))) {
        throw new Error("VS Code could not complete the case-only file rename.");
      }
    } catch (error) {
      await rollbackFileRename(
        transaction.intermediateUri,
        transaction.previousUri,
        error,
      );
    }
  }

  try {
    if (!(await applyValidatedContentEdit(transaction))) {
      throw new Error("VS Code rejected the link and title updates.");
    }
  } catch (error) {
    if (fileRenamed) {
      await rollbackFileRename(
        transaction.nextUri,
        transaction.previousUri,
        error,
        transaction.intermediateUri,
      );
    }
    throw error;
  }
}

async function applyValidatedContentEdit(transaction: RenameTransaction): Promise<boolean> {
  if (!transaction.hasContentEdits) return true;
  let openDocuments = new Map(
    vscode.workspace.textDocuments.map((document) => [document.uri.toString(), document]),
  );
  const missing = transaction.expectedDocuments.filter(
    (expected) => !openDocuments.has(expected.uri.toString()),
  );
  if (missing.length > 0) {
    await mapConcurrent(missing, 16, async (expected) => vscode.workspace.openTextDocument(expected.uri));
    openDocuments = new Map(
      vscode.workspace.textDocuments.map((document) => [document.uri.toString(), document]),
    );
  }
  for (const expected of transaction.expectedDocuments) {
    if (openDocuments.get(expected.uri.toString())?.getText() !== expected.source) {
      throw new Error(`The file ${expected.uri.fsPath} changed after the preview.`);
    }
  }
  return vscode.workspace.applyEdit(transaction.contentEdit);
}

async function rollbackFileRename(
  currentUri: vscode.Uri,
  previousUri: vscode.Uri,
  cause: unknown,
  bridgeUri?: vscode.Uri,
): Promise<never> {
  const message = cause instanceof Error ? cause.message : String(cause);
  const rollback = await tryRollbackFileRename(currentUri, previousUri, bridgeUri);
  const rolledBack = rollback.location.toString() === previousUri.toString();
  if (rolledBack) {
    throw new Error(`${message} The file rename was rolled back; no content updates were applied.`);
  }
  throw new Error(
    `${message} Automatic rollback failed; the note remains at ${rollback.location.fsPath}. ` +
    "No link or title updates were applied.",
  );
}

async function tryRollbackFileRename(
  currentUri: vscode.Uri,
  previousUri: vscode.Uri,
  bridgeUri?: vscode.Uri,
): Promise<{ readonly location: vscode.Uri }> {
  let location = currentUri;
  if (bridgeUri) {
    if (!(await tryExclusiveRename(currentUri, bridgeUri))) return { location };
    location = bridgeUri;
  }
  if (await tryExclusiveRename(location, previousUri)) location = previousUri;
  return { location };
}

async function tryExclusiveRename(previousUri: vscode.Uri, nextUri: vscode.Uri): Promise<boolean> {
  const edit = new vscode.WorkspaceEdit();
  edit.renameFile(previousUri, nextUri, { overwrite: false, ignoreIfExists: false });
  try {
    return await vscode.workspace.applyEdit(edit);
  } catch {
    return false;
  }
}

function addMetadataEdit(edits: OffsetTextEdit[], next: OffsetTextEdit): void {
  if (next.start === next.end) {
    const existingIndex = edits.findIndex(
      (edit) => edit.start === next.start && edit.end === next.end,
    );
    if (existingIndex !== -1) {
      const existing = edits[existingIndex]!;
      edits[existingIndex] = { ...existing, text: `${next.text}${existing.text}` };
      return;
    }
  }
  edits.push(next);
}

function previewDocument(
  documents: readonly PlannedDocument[],
  renamedUri: string,
  renamedPath: string,
  apply = false,
): string {
  return [...documents]
    .sort((left, right) => left.document.uri.toString().localeCompare(right.document.uri.toString()))
    .map((planned) => {
      const path = planned.document.uri.toString() === renamedUri
        ? renamedPath
        : vscode.workspace.asRelativePath(planned.document.uri);
      const source = apply ? applyTextEdits(planned.source, planned.edits) : planned.source;
      return `<!-- ${path} -->\n${source}`;
    })
    .join("\n\n<!-- next file -->\n\n");
}
