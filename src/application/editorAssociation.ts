/**
 * Pure helpers for `workbench.editorAssociations`.
 *
 * Visp Notes contributes its custom editor with `priority: "option"` so that installing
 * the extension never takes over unrelated Markdown files such as a repository README.
 * Users opt in explicitly, and opting in is expressed through the same setting VS Code
 * writes from its own "Configure Editor Association" flow.
 */

export const MARKDOWN_ASSOCIATION_GLOB = "*.md";

export type EditorAssociations = Readonly<Record<string, string>>;

export function readEditorAssociations(value: unknown): EditorAssociations {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  const associations: Record<string, string> = {};
  for (const [glob, viewType] of Object.entries(value as Record<string, unknown>)) {
    if (typeof viewType === "string") {
      associations[glob] = viewType;
    }
  }
  return associations;
}

export function isDefaultEditorFor(
  associations: EditorAssociations,
  glob: string,
  viewType: string,
): boolean {
  return associations[glob] === viewType;
}

export function withDefaultEditor(
  associations: EditorAssociations,
  glob: string,
  viewType: string,
): EditorAssociations {
  return { ...associations, [glob]: viewType };
}

/**
 * Removes the association only when `viewType` currently owns it, so an association
 * another extension established is never silently discarded. Returns `undefined` when
 * nothing is left, letting the caller clear the setting instead of writing `{}`.
 */
export function withoutDefaultEditor(
  associations: EditorAssociations,
  glob: string,
  viewType: string,
): EditorAssociations | undefined {
  const next = { ...associations };
  if (next[glob] === viewType) {
    delete next[glob];
  }
  return Object.keys(next).length === 0 ? undefined : next;
}

/** The view type VS Code's own association flow writes for "the built-in text editor". */
export const BUILT_IN_EDITOR_VIEW_TYPE = "default";

/**
 * The association the open workspace pins for `glob`, most specific scope winning.
 *
 * The two commands write the global scope, which is the weaker one, so this is what decides
 * whether the setting they just wrote is the one that actually takes effect here.
 */
export function workspaceAssociationFor(
  glob: string,
  workspaceFolderValue: unknown,
  workspaceValue: unknown,
): string | undefined {
  for (const value of [workspaceFolderValue, workspaceValue]) {
    if (value === undefined) continue;
    const association = readEditorAssociations(value)[glob];
    if (association !== undefined) return association;
  }
  return undefined;
}

/**
 * Whether a workspace-pinned association disagrees with the editor the user just chose.
 *
 * Presence alone is not disagreement, which is the distinction the first version of this check
 * missed: a workspace pinning the very editor the command just made the default was reported as
 * an exception to it, and so was a workspace pinning the built-in editor right after the user
 * asked for the built-in editor. Only a workspace naming a different view type contradicts the
 * command, and only then is there anything to warn about.
 */
export function workspacePinContradicts(
  workspaceAssociation: string | undefined,
  chosenViewType: string,
): boolean {
  return workspaceAssociation !== undefined && workspaceAssociation !== chosenViewType;
}
