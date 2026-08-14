import { posix } from "node:path";
import * as vscode from "vscode";
import type { NoteRecord, SkippedNote } from "../domain/models";
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
 * What reading a note produced: the record, or the reason there is no record.
 *
 * This used to be `NoteRecord | undefined`, and the caller collapsed that `undefined` together
 * with the one it produces for a file that is not there — so by the time a snapshot was built,
 * the fact that an oversized note EXISTS had been thrown away, and nothing downstream could
 * tell the user why their note had gone. The size decision is unchanged; only what is
 * remembered about it is.
 */
export type NoteRead =
  | { readonly kind: "note"; readonly note: NoteRecord }
  | { readonly kind: "oversized"; readonly skipped: SkippedNote };

export async function readNoteRecord(uri: vscode.Uri): Promise<NoteRead> {
  const openDocument = vscode.workspace.textDocuments.find(
    (document) => document.uri.toString() === uri.toString(),
  );
  /*
   * Stat first rather than alongside the read. Reading the file and then deciding it is too
   * big would have already spent the memory the limit exists to protect.
   */
  const stat = await vscode.workspace.fs.stat(uri);
  const limitBytes = noteSizeLimitBytes(
    vscode.workspace.getConfiguration("vispNotes", uri).get<number>("maxNoteSizeKB"),
  );
  const includeRoot = (vscode.workspace.workspaceFolders?.length ?? 0) > 1;
  const path = vscode.workspace.asRelativePath(uri, includeRoot).replace(/\\/g, "/");
  const tooLarge = (sizeBytes: number): NoteRead => ({
    kind: "oversized",
    // `limitBytes` is only ever undefined when nothing is too large, so this branch has one.
    skipped: { uri: uri.toString(), path, sizeBytes, limitBytes: limitBytes ?? sizeBytes },
  });
  if (!isWithinNoteSizeLimit(stat.size, limitBytes)) return tooLarge(stat.size);

  const bytes = openDocument ? undefined : await vscode.workspace.fs.readFile(uri);
  const content = openDocument?.getText() ?? new TextDecoder().decode(bytes);
  /*
   * An open document is measured again from its text: it may hold unsaved edits far larger
   * than the file on disk, and it is that text the index would keep.
   */
  if (openDocument && !isWithinNoteSizeLimit(content.length, limitBytes)) {
    return tooLarge(content.length);
  }
  const parsed = parseMarkdown(content);
  const fileName = posix.basename(uri.path);

  return {
    kind: "note",
    note: {
      ...parsed,
      uri: uri.toString(),
      path,
      fileName,
      title: parsed.title?.trim() || noteStem(fileName),
      /*
       * `ctime` is creation time in the VS Code API, but some file systems cannot record one
       * and report zero; leaving it out keeps "unknown" distinguishable from 1970.
       */
      ...(stat.ctime > 0 ? { createdAt: stat.ctime } : {}),
      modifiedAt: stat.mtime,
      content,
    },
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
