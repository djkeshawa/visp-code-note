import * as vscode from "vscode";
import type { WikiLink } from "../domain/models";
import { isIndexableMarkdown } from "../indexing/discovery";
import type { WorkspaceIndex } from "../indexing/workspaceIndex";
import { createWikiReferenceResolver } from "../indexing/wikiReferenceResolver";
import type { WikiReferenceResult } from "../indexing/wikiReferenceResolver";
import { parseMarkdown } from "../markdown/parser";
import { TextRangeMapper, documentRange } from "./utils/ranges";

export const UNRESOLVED_WIKI_LINK_CODE = "vispNotes.unresolvedWikiLink";
export const MISSING_WIKI_HEADING_CODE = "vispNotes.missingWikiHeading";
export const MISSING_WIKI_BLOCK_CODE = "vispNotes.missingWikiBlock";

export class WikiLinkDiagnostics implements vscode.Disposable {
  private readonly collection = vscode.languages.createDiagnosticCollection("visp-notes");
  private readonly subscriptions: vscode.Disposable[];

  constructor(private readonly index: WorkspaceIndex) {
    this.subscriptions = [
      index.onDidChange(() => this.refresh()),
      vscode.workspace.onDidChangeTextDocument((event) => this.updateDocument(event.document)),
      vscode.workspace.onDidCloseTextDocument(() => this.refresh()),
    ];
    this.refresh();
  }

  refresh(): void {
    const linksBySource = groupLinksBySource(this.index.snapshot.links);
    const resolver = createWikiReferenceResolver(this.index.snapshot.notes);
    const openDocuments = new Map(
      vscode.workspace.textDocuments.map((document) => [document.uri.toString(), document]),
    );
    this.collection.clear();
    for (const note of this.index.snapshot.notes) {
      const document = openDocuments.get(note.uri);
      if (document) {
        this.updateDocument(document);
        continue;
      }

      const links = linksBySource.get(note.uri) ?? [];
      const mapper = new TextRangeMapper(note.content);
      this.collection.set(
        vscode.Uri.parse(note.uri),
        links.flatMap((link) => {
          const result = resolver.resolve(note.uri, link);
          return result.status === "resolved"
            ? []
            : [createDiagnostic(link, result, mapper.range(link.range))];
        }),
      );
    }
  }

  dispose(): void {
    vscode.Disposable.from(...this.subscriptions).dispose();
    this.collection.dispose();
  }

  private updateDocument(document: vscode.TextDocument): void {
    if (document.languageId !== "markdown" || !isIndexableMarkdown(document.uri)) {
      this.collection.delete(document.uri);
      return;
    }
    const links = parseMarkdown(document.getText()).links;
    const resolver = createWikiReferenceResolver(this.index.snapshot.notes);
    this.collection.set(
      document.uri,
      links.flatMap((link) => {
        const result = resolver.resolve(document.uri.toString(), link);
        return result.status === "resolved"
          ? []
          : [createDiagnostic(link, result, documentRange(document, link.range))];
      }),
    );
  }
}

function createDiagnostic(
  link: WikiLink,
  result: Exclude<WikiReferenceResult, { readonly status: "resolved" }>,
  range: vscode.Range,
): vscode.Diagnostic {
  const diagnostic = new vscode.Diagnostic(
    range,
    diagnosticMessage(result),
    vscode.DiagnosticSeverity.Warning,
  );
  diagnostic.source = "Visp Notes";
  diagnostic.code = diagnosticCode(result);
  return diagnostic;
}

function diagnosticMessage(
  result: Exclude<WikiReferenceResult, { readonly status: "resolved" }>,
): string {
  switch (result.status) {
    case "missing-note":
      return `Unresolved wiki link: ${result.target}`;
    case "missing-heading":
      return `Missing heading “${result.heading}” in ${result.note.title}`;
    case "missing-block":
      return `Missing block “^${result.blockId}” in ${result.note.title}`;
  }
}

function diagnosticCode(
  result: Exclude<WikiReferenceResult, { readonly status: "resolved" }>,
): string {
  switch (result.status) {
    case "missing-note":
      return UNRESOLVED_WIKI_LINK_CODE;
    case "missing-heading":
      return MISSING_WIKI_HEADING_CODE;
    case "missing-block":
      return MISSING_WIKI_BLOCK_CODE;
  }
}

function groupLinksBySource(
  links: readonly { readonly sourceUri: string; readonly link: WikiLink }[],
): ReadonlyMap<string, readonly WikiLink[]> {
  const grouped = new Map<string, WikiLink[]>();
  for (const { sourceUri, link } of links) {
    const values = grouped.get(sourceUri) ?? [];
    values.push(link);
    grouped.set(sourceUri, values);
  }
  return grouped;
}
