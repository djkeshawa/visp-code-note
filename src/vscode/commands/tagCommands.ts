import * as vscode from "vscode";
import { planTagAddition, planTagRemoval } from "../../application/noteMetadataEdits";
import { buildNoteContext } from "../../indexing/projections";
import { pickTag } from "../providers/tagPicker";
import { activeMarkdownUri } from "./commandUtils";
import type { CommandIndex, FeatureViews } from "./contracts";

/**
 * Adds a tag to the active note's frontmatter.
 *
 * A note open in the Visp Notes editor is edited by the webview, so the change joins the
 * draft that editor is already holding and stays undoable. A note open in VS Code's own
 * text editor has no draft, so the same planned edit is applied directly.
 */
export async function addTagToNote(index: CommandIndex, views: FeatureViews): Promise<void> {
  const target = resolveTarget(views);
  if (target === undefined) {
    void vscode.window.showInformationMessage("Open a Markdown note before adding a tag.");
    return;
  }
  const declared = frontmatterTags(index, target.uri);
  const tag = await pickTag(index.snapshot, {
    title: "Add a tag to this note",
    exclude: new Set(declared.map((name) => name.toLocaleLowerCase())),
  });
  if (tag === undefined) return;

  if (target.kind === "visp") {
    if (!(await views.insertTag(tag))) {
      void vscode.window.showInformationMessage("Focus a Visp note editor before adding a tag.");
    }
    return;
  }
  await applyToTextDocument(target.uri, (source) => planTagAddition(source, tag));
}

export async function removeTagFromNote(index: CommandIndex, views: FeatureViews): Promise<void> {
  const target = resolveTarget(views);
  if (target === undefined) {
    void vscode.window.showInformationMessage("Open a Markdown note before removing a tag.");
    return;
  }
  const declared = frontmatterTags(index, target.uri);
  if (declared.length === 0) {
    void vscode.window.showInformationMessage(
      "This note declares no tags in its frontmatter. Inline #tags are edited in the note body.",
    );
    return;
  }
  const picked = await vscode.window.showQuickPick(
    declared.map((tag) => ({ label: `#${tag}`, tag })),
    { placeHolder: "Remove a tag from this note" },
  );
  if (picked === undefined) return;

  if (target.kind === "visp") {
    if (!(await views.removeTag(picked.tag))) {
      void vscode.window.showInformationMessage("Focus a Visp note editor before removing a tag.");
    }
    return;
  }
  await applyToTextDocument(target.uri, (source) => planTagRemoval(source, picked.tag));
}

interface TagTarget {
  readonly uri: vscode.Uri;
  readonly kind: "text" | "visp";
}

/** A focused Markdown text editor wins, because that is what the user is looking at. */
function resolveTarget(views: FeatureViews): TagTarget | undefined {
  const text = activeMarkdownUri();
  if (text !== undefined) return { uri: text, kind: "text" };
  const visp = views.activeNoteUri();
  return visp === undefined ? undefined : { uri: visp, kind: "visp" };
}

function frontmatterTags(index: CommandIndex, uri: vscode.Uri): readonly string[] {
  return buildNoteContext(index.snapshot, uri.toString())?.frontmatterTags ?? [];
}

async function applyToTextDocument(
  uri: vscode.Uri,
  plan: (source: string) => { readonly start: number; readonly end: number; readonly text: string } | undefined,
): Promise<void> {
  const document = await vscode.workspace.openTextDocument(uri);
  const planned = plan(document.getText());
  if (planned === undefined) {
    void vscode.window.showInformationMessage("That tag is not in this note's frontmatter.");
    return;
  }
  const edit = new vscode.WorkspaceEdit();
  edit.replace(
    uri,
    new vscode.Range(document.positionAt(planned.start), document.positionAt(planned.end)),
    planned.text,
  );
  if (!(await vscode.workspace.applyEdit(edit))) {
    throw new Error("VS Code could not update the note's frontmatter.");
  }
}
