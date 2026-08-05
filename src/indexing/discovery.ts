import { posix } from "node:path";
import * as vscode from "vscode";
import type { NoteRecord } from "../domain/models";
import { noteStem } from "../domain/normalization";
import { parseMarkdown } from "../markdown/parser";
import { matchesAnyGlob } from "./glob";
import { isWithinNoteSizeLimit, noteSizeLimitBytes } from "../application/noteSizeLimit";

const DEFAULT_EXCLUDES = [
  "**/node_modules/**",
  "**/.git/**",
  "**/dist/**",
  "**/out/**",
] as const;

export async function discoverMarkdownUris(): Promise<readonly vscode.Uri[]> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const discovered = await Promise.all(
    folders.map((folder) =>
      vscode.workspace.findFiles(
        new vscode.RelativePattern(folder, "**/*.md"),
        combineExcludes(readExcludes(folder.uri)),
      ),
    ),
  );

  const unique = new Map<string, vscode.Uri>();
  for (const uri of discovered.flat()) {
    unique.set(uriKey(uri), uri);
  }
  return [...unique.values()].sort((left, right) => left.path.localeCompare(right.path));
}

export function isIndexableMarkdown(uri: vscode.Uri): boolean {
  if (!uri.path.toLocaleLowerCase().endsWith(".md")) {
    return false;
  }

  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (!folder) {
    return false;
  }

  const relativePath = posix.relative(folder.uri.path, uri.path);
  return !matchesAnyGlob(relativePath, readExcludes(folder.uri));
}

/**
 * Reads a note, or returns `undefined` when it is too large to index — see `noteSizeLimit`.
 * The caller already treats an absent record as a note that is not in the index, which is
 * exactly what an oversized note should be.
 */
export async function readNoteRecord(uri: vscode.Uri): Promise<NoteRecord | undefined> {
  const openDocument = vscode.workspace.textDocuments.find(
    (document) => document.uri.toString() === uri.toString(),
  );
  /*
   * Stat first rather than alongside the read. Reading the file and then deciding it is too
   * big would have already spent the memory the limit exists to protect.
   */
  const stat = await vscode.workspace.fs.stat(uri);
  const limit = noteSizeLimitBytes(
    vscode.workspace.getConfiguration("vispNotes", uri).get<number>("maxNoteSizeKB"),
  );
  if (!isWithinNoteSizeLimit(stat.size, limit)) return undefined;

  const bytes = openDocument ? undefined : await vscode.workspace.fs.readFile(uri);
  const content = openDocument?.getText() ?? new TextDecoder().decode(bytes);
  /*
   * An open document is measured again from its text: it may hold unsaved edits far larger
   * than the file on disk, and it is that text the index would keep.
   */
  if (openDocument && !isWithinNoteSizeLimit(content.length, limit)) return undefined;
  const parsed = parseMarkdown(content);
  const fileName = posix.basename(uri.path);
  const includeRoot = (vscode.workspace.workspaceFolders?.length ?? 0) > 1;

  return {
    ...parsed,
    uri: uri.toString(),
    path: vscode.workspace.asRelativePath(uri, includeRoot).replace(/\\/g, "/"),
    fileName,
    title: parsed.title?.trim() || noteStem(fileName),
    /*
     * `ctime` is creation time in the VS Code API, but some file systems cannot record one
     * and report zero; leaving it out keeps "unknown" distinguishable from 1970.
     */
    ...(stat.ctime > 0 ? { createdAt: stat.ctime } : {}),
    modifiedAt: stat.mtime,
    content,
  };
}

export function uriKey(uri: vscode.Uri | string): string {
  return typeof uri === "string" ? vscode.Uri.parse(uri).toString() : uri.toString();
}

function readExcludes(scope: vscode.Uri): readonly string[] {
  return vscode.workspace
    .getConfiguration("vispNotes", scope)
    .get<readonly string[]>("exclude", DEFAULT_EXCLUDES)
    .map((pattern) => pattern.trim())
    .filter(Boolean);
}

function combineExcludes(patterns: readonly string[]): string | undefined {
  if (patterns.length === 0) {
    return undefined;
  }
  return patterns.length === 1 ? patterns[0] : `{${patterns.join(",")}}`;
}
