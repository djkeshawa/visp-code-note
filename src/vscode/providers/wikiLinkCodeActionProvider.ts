import * as vscode from "vscode";
import { parseMarkdown } from "../../markdown/parser";
import { UNRESOLVED_WIKI_LINK_CODE } from "../diagnostics";
import { COMMAND_IDS } from "../ids";

export class WikiLinkCodeActionProvider implements vscode.CodeActionProvider {
  public static readonly metadata: vscode.CodeActionProviderMetadata = {
    providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
  };

  public provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range,
    context: vscode.CodeActionContext,
  ): vscode.CodeAction[] {
    const unresolved = context.diagnostics.find((diagnostic) =>
      diagnostic.code === UNRESOLVED_WIKI_LINK_CODE,
    );
    if (!unresolved) return [];

    const offset = document.offsetAt(unresolved.range.start);
    const link = parseMarkdown(document.getText()).links.find(
      (candidate) => candidate.range.start <= offset && candidate.range.end > offset,
    );
    if (!link?.target) return [];

    const action = new vscode.CodeAction(
      `Create note “${link.target}”`,
      vscode.CodeActionKind.QuickFix,
    );
    action.diagnostics = [unresolved];
    action.isPreferred = true;
    action.command = {
      command: COMMAND_IDS.createMissingNote,
      title: "Create missing note",
      arguments: [document.uri, link.target],
    };
    return [action];
  }
}
