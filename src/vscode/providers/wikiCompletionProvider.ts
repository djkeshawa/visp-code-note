import * as vscode from "vscode";
import { wikiCompletionText } from "../../application/wikiCompletion";
import { limitWikiSuggestions, rankWikiSuggestions } from "../../application/wikiSuggestions";
import type { WorkspaceIndex } from "../../indexing/workspaceIndex";
import { buildNoteSuggestions } from "./noteEditorSupport";

export class WikiCompletionProvider implements vscode.CompletionItemProvider {
  constructor(private readonly index: WorkspaceIndex) {}

  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.CompletionList | undefined {
    const linePrefix = document.lineAt(position).text.slice(0, position.character);
    const opener = linePrefix.lastIndexOf("[[");
    if (opener === -1) {
      return undefined;
    }

    const query = linePrefix.slice(opener + 2);
    if (/[|[\]]/.test(query)) {
      return undefined;
    }

    const replacement = new vscode.Range(position.line, opener + 2, position.line, position.character);
    const textAfterCursor = document.lineAt(position).text.slice(position.character);
    const notes = buildNoteSuggestions(this.index.snapshot.notes, document.uri.toString());
    const batch = limitWikiSuggestions(rankWikiSuggestions(notes, query), 50);
    const items = batch.items.map((candidate, index) => {
      const item = new vscode.CompletionItem(candidate.label, completionKind(candidate.kind));
      item.detail = `${capitalize(candidate.kind)} · ${candidate.path}`;
      item.filterText = candidate.filterText;
      item.sortText = String(index).padStart(4, "0");
      item.insertText = wikiCompletionText(candidate.target, textAfterCursor);
      item.range = replacement;
      return item;
    });
    return new vscode.CompletionList(items, batch.isIncomplete);
  }
}

function completionKind(kind: "note" | "heading" | "block"): vscode.CompletionItemKind {
  switch (kind) {
    case "heading":
      return vscode.CompletionItemKind.Field;
    case "block":
      return vscode.CompletionItemKind.Constant;
    case "note":
      return vscode.CompletionItemKind.Reference;
  }
}

function capitalize(value: string): string {
  return value.charAt(0).toLocaleUpperCase() + value.slice(1);
}
