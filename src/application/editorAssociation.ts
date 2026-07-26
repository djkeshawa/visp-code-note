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
