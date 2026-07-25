import * as vscode from "vscode";

export class NoteEditorPanelRegistry implements vscode.Disposable {
  private readonly panels = new Map<string, Set<vscode.WebviewPanel>>();
  private readonly subscriptions = new Map<vscode.WebviewPanel, vscode.Disposable[]>();
  private readonly readyPanels = new WeakSet<vscode.WebviewPanel>();
  private activePanel: vscode.WebviewPanel | undefined;
  private activeDocumentUri: vscode.Uri | undefined;

  public constructor(
    private readonly onActivate: (uri: string) => void,
    private readonly onDisposePanel: (panel: vscode.WebviewPanel) => void,
  ) {}

  public track(document: vscode.TextDocument, panel: vscode.WebviewPanel): void {
    const key = document.uri.toString();
    const documentPanels = this.panels.get(key) ?? new Set<vscode.WebviewPanel>();
    documentPanels.add(panel);
    this.panels.set(key, documentPanels);
    this.activate(panel, document.uri);

    const disposables: vscode.Disposable[] = [];
    disposables.push(
      panel.onDidChangeViewState(({ webviewPanel }) => {
        if (webviewPanel.active) this.activate(webviewPanel, document.uri);
      }),
      panel.onDidDispose(() => this.untrack(key, panel, documentPanels)),
    );
    this.subscriptions.set(panel, disposables);
  }

  public addSubscription(panel: vscode.WebviewPanel, disposable: vscode.Disposable): void {
    this.subscriptions.get(panel)?.push(disposable);
  }

  public markReady(panel: vscode.WebviewPanel): void {
    this.readyPanels.add(panel);
  }

  public isReady(panel: vscode.WebviewPanel): boolean {
    return this.readyPanels.has(panel);
  }

  public get active(): vscode.WebviewPanel | undefined {
    return this.activePanel;
  }

  public get activeUri(): vscode.Uri | undefined {
    return this.activePanel?.active ? this.activeDocumentUri : undefined;
  }

  public forDocument(uri: string): ReadonlySet<vscode.WebviewPanel> | undefined {
    return this.panels.get(uri);
  }

  public entries(): IterableIterator<[string, Set<vscode.WebviewPanel>]> {
    return this.panels.entries();
  }

  public dispose(): void {
    for (const disposables of this.subscriptions.values()) {
      vscode.Disposable.from(...disposables).dispose();
    }
    this.subscriptions.clear();
    this.panels.clear();
    this.activePanel = undefined;
    this.activeDocumentUri = undefined;
  }

  private activate(panel: vscode.WebviewPanel, uri: vscode.Uri): void {
    this.activePanel = panel;
    this.activeDocumentUri = uri;
    this.onActivate(uri.toString());
  }

  private untrack(
    key: string,
    panel: vscode.WebviewPanel,
    documentPanels: Set<vscode.WebviewPanel>,
  ): void {
    this.onDisposePanel(panel);
    const disposables = this.subscriptions.get(panel) ?? [];
    this.subscriptions.delete(panel);
    for (const disposable of disposables) disposable.dispose();
    documentPanels.delete(panel);
    if (documentPanels.size === 0) this.panels.delete(key);
    if (this.activePanel === panel) {
      this.activePanel = undefined;
      this.activeDocumentUri = undefined;
    }
  }
}
