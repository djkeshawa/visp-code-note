import * as vscode from "vscode";

const SCHEME = "visp-notes-preview";

export class TextDiffPreviewProvider
  implements vscode.TextDocumentContentProvider, vscode.Disposable
{
  private readonly documents = new Map<string, string>();
  private sequence = 0;

  public register(): vscode.Disposable {
    return vscode.workspace.registerTextDocumentContentProvider(SCHEME, this);
  }

  public provideTextDocumentContent(uri: vscode.Uri): string {
    return this.documents.get(uri.toString()) ?? "Preview is no longer available.";
  }

  public async show(title: string, before: string, after: string): Promise<void> {
    this.documents.clear();
    const id = ++this.sequence;
    const left = vscode.Uri.from({ scheme: SCHEME, path: `/${id}/before.md` });
    const right = vscode.Uri.from({ scheme: SCHEME, path: `/${id}/after.md` });
    this.documents.set(left.toString(), before);
    this.documents.set(right.toString(), after);
    await vscode.commands.executeCommand("vscode.diff", left, right, title, {
      preview: true,
      preserveFocus: false,
    });
  }

  public dispose(): void {
    this.documents.clear();
  }
}
