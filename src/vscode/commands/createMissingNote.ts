import { posix } from "node:path";
import * as vscode from "vscode";
import { planMissingNotePath } from "../../application/missingNotePath";
import { decodeWikiTarget } from "../../domain/normalization";
import { resolveWikiTarget } from "../../indexing/projections";
import { isIndexableMarkdown } from "../../indexing/discovery";
import type { CommandIndex } from "./contracts";
import { createNote } from "./createNote";
import { openNote } from "./openNote";
import { uriExists } from "./commandUtils";

export async function createMissingNote(
  index: CommandIndex,
  sourceValue: unknown,
  targetValue: unknown,
): Promise<void> {
  if (!(sourceValue instanceof vscode.Uri) || typeof targetValue !== "string") return;
  const decodedTarget = decodeWikiTarget(targetValue);
  const folder = vscode.workspace.getWorkspaceFolder(sourceValue);
  if (!folder) throw new Error("The source note is not inside an open workspace folder.");

  const sourceRelative = posix.relative(folder.uri.path, sourceValue.path);
  const plan = planMissingNotePath(sourceRelative, decodedTarget);
  if (!plan) {
    await createNote(index, decodedTarget);
    return;
  }

  const uri = vscode.Uri.joinPath(folder.uri, ...plan.relativePath.split("/"));
  if (!isIndexableMarkdown(uri)) {
    throw new Error("That path is excluded from the Visp Notes index.");
  }
  if (await uriExists(uri)) {
    await index.refresh(uri);
    await openResolvedOrThrow(index, sourceValue, targetValue, uri);
    return;
  }

  const parent = uri.with({ path: posix.dirname(uri.path) });
  await vscode.workspace.fs.createDirectory(parent);
  const edit = new vscode.WorkspaceEdit();
  edit.createFile(uri, {
    overwrite: false,
    ignoreIfExists: false,
    contents: new TextEncoder().encode(`# ${plan.title}\n\n`),
  });
  if (!(await vscode.workspace.applyEdit(edit))) {
    if (!(await uriExists(uri))) throw new Error(`VS Code could not create ${uri.fsPath}.`);
  }
  await index.refresh(uri);
  await openResolvedOrThrow(index, sourceValue, targetValue, uri);
}

async function openResolvedOrThrow(
  index: CommandIndex,
  sourceUri: vscode.Uri,
  target: string,
  expectedUri: vscode.Uri,
): Promise<void> {
  const resolved = resolveWikiTarget(index.snapshot, sourceUri.toString(), target);
  if (resolved?.uri !== expectedUri.toString()) {
    throw new Error("The note was created, but the original wiki target still resolves elsewhere.");
  }
  await openNote(expectedUri, true);
}
