import * as vscode from "vscode";
import { decodeWikiTarget, slugifyHeading } from "../../domain/normalization";
import { createWikiReferenceResolver } from "../../indexing/wikiReferenceResolver";
import type { WorkspaceIndex } from "../../indexing/workspaceIndex";
import { parseMarkdown } from "../../markdown/parser";
import { documentRange } from "../utils/ranges";

export class WikiLinkProvider implements vscode.DocumentLinkProvider {
  constructor(private readonly index: WorkspaceIndex) {}

  provideDocumentLinks(document: vscode.TextDocument): vscode.DocumentLink[] {
    const parsed = parseMarkdown(document.getText());
    const resolver = createWikiReferenceResolver(this.index.snapshot.notes);
    return parsed.links.flatMap((link) => {
      const result = resolver.resolve(document.uri.toString(), link);
      if (result.status !== "resolved") {
        return [];
      }

      const fragment = link.blockId
        ? `^${decodeWikiTarget(link.blockId)}`
        : link.heading
          ? slugifyHeading(decodeWikiTarget(link.heading))
          : undefined;
      const targetUri = vscode.Uri.parse(result.note.uri).with({ fragment });
      const documentLink = new vscode.DocumentLink(documentRange(document, link.range), targetUri);
      documentLink.tooltip = `Open ${result.note.title}`;
      return [documentLink];
    });
  }
}
