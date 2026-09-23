import { posix } from "node:path";
import * as vscode from "vscode";

/**
 * Why VS Code refused to write a note, as far as the file system can say.
 *
 * `TextDocument.save()` answers a bare `false`, and the reason a reader can act on is almost
 * always one of two. The file may be read-only. Far more often, the file on disk changed after
 * the note was opened — another program, a `git checkout`, a script — and VS Code will not
 * silently overwrite a newer file. Its own Save shows a Compare / Overwrite prompt for that;
 * a save through the API shows nothing, which left the reader with a banner blaming a
 * formatter and no way to finish the save.
 */
export type RefusedSave = "read-only" | "changed-on-disk";

export async function diagnoseRefusedSave(uri: vscode.Uri): Promise<RefusedSave> {
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    if (((stat.permissions ?? 0) & vscode.FilePermission.Readonly) !== 0) return "read-only";
  } catch {
    // A file that cannot even be stat'ed has changed on disk in the most literal way.
  }
  return "changed-on-disk";
}

export function describeRefusedSave(uri: vscode.Uri, reason: RefusedSave): string {
  const name = posix.basename(uri.path);
  return reason === "read-only"
    ? `${name} is read-only, so VS Code could not save it. Your changes are still here.`
    : `${name} changed on disk after you started editing it, so VS Code did not overwrite it. ` +
      "Your changes are still here — choose Overwrite, Use Disk Version, or Compare.";
}

const COMPARE = "Compare";
const OVERWRITE = "Overwrite";
const USE_DISK = "Use Disk Version";

/**
 * The choice VS Code's own Save would have offered, for a note saved from the Visp Notes
 * editor. Both resolutions go through VS Code's revert so the document it holds ends clean and
 * in step with the file: Overwrite writes the note's text to disk first, so reverting loads
 * exactly what the reader had; Use Disk Version reverts straight to the file.
 */
export class SaveConflictPrompt {
  private readonly open = new Set<string>();

  public constructor(
    private readonly showDiff: (title: string, before: string, after: string) => Promise<void>,
  ) {}

  public offer(document: vscode.TextDocument, settled: () => Promise<void>): void {
    const key = document.uri.toString();
    if (this.open.has(key)) return;
    this.open.add(key);
    void this.ask(document, settled).finally(() => this.open.delete(key));
  }

  private async ask(document: vscode.TextDocument, settled: () => Promise<void>): Promise<void> {
    const name = posix.basename(document.uri.path);
    for (;;) {
      const choice = await vscode.window.showWarningMessage(
        `${name} changed on disk after you started editing it. Keep your version or the one on disk?`,
        OVERWRITE,
        USE_DISK,
        COMPARE,
      );
      if (choice === COMPARE) {
        const disk = new TextDecoder().decode(await vscode.workspace.fs.readFile(document.uri));
        await this.showDiff(`${name} — on disk ↔ your version`, disk, document.getText());
        continue;
      }
      if (choice === OVERWRITE) {
        await vscode.workspace.fs.writeFile(document.uri, new TextEncoder().encode(document.getText()));
      }
      if (choice === OVERWRITE || choice === USE_DISK) {
        await vscode.commands.executeCommand("workbench.action.files.revert", document.uri);
        await settled();
      }
      return;
    }
  }
}
