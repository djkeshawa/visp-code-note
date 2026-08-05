import { posix } from "node:path";
import * as vscode from "vscode";
import type { NoteRecord } from "../domain/models";
import { noteStem } from "../domain/normalization";
import { parseMarkdown } from "../markdown/parser";
import { matchesAnyGlob } from "./glob";

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

export async function readNoteRecord(uri: vscode.Uri): Promise<NoteRecord> {
  const openDocument = vscode.workspace.textDocuments.find(
    (document) => document.uri.toString() === uri.toString(),
  );
  const [bytes, stat] = await Promise.all([
    openDocument ? undefined : vscode.workspace.fs.readFile(uri),
    vscode.workspace.fs.stat(uri),
  ]);
  const content = openDocument?.getText() ?? new TextDecoder().decode(bytes);
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
