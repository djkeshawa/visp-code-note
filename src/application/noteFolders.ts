import { posix } from "node:path";
import { normalizeWorkspaceRelativeFolder } from "./workspacePath";

/**
 * Where a new note could go.
 *
 * `vispNotes.notesFolder` names one folder, and until now every note went into it. That setting
 * is the right default and stays the default — it heads this list — but a workspace that has
 * grown a `journal/`, a `meetings/` and a `reference/` should be able to say so at the moment it
 * matters rather than by editing a setting between notes.
 *
 * The list is drawn from folders that already hold notes, because those are the folders the
 * workspace has actually decided on. Nested ones are included in full: `projects/visp` is a real
 * place to put a note, and offering only `projects` would send it to the wrong one.
 */

export interface NoteFolderChoice {
  /** Workspace-relative, `""` for the root. */
  readonly path: string;
  readonly label: string;
  /** How many notes already live directly in it. */
  readonly count: number;
  /** True for the folder `vispNotes.notesFolder` names. */
  readonly configured: boolean;
}

const ROOT_LABEL = "Workspace root";

export function noteFolderChoices(
  notes: readonly { readonly path: string }[],
  configuredFolder: string,
): readonly NoteFolderChoice[] {
  const configured = safeNormalize(configuredFolder);
  const counts = new Map<string, number>([[configured, 0]]);
  // The root is always offerable, even in a workspace whose notes all sit in folders.
  counts.set("", counts.get("") ?? 0);

  for (const note of notes) {
    const folder = note.path.split("/").slice(0, -1).join("/");
    counts.set(folder, (counts.get(folder) ?? 0) + 1);
  }

  const rest = [...counts.entries()]
    .filter(([path]) => path !== configured)
    .sort(([left], [right]) => left.localeCompare(right, undefined, { sensitivity: "base" }));

  return [
    { path: configured, count: counts.get(configured) ?? 0, ...labelFor(configured), configured: true },
    ...rest.map(([path, count]) => ({ path, count, ...labelFor(path), configured: false })),
  ];
}

/**
 * The notes under one workspace root, with paths relative to that root.
 *
 * `NoteRecord.path` is not that: in a multi-root workspace it leads with the root folder's
 * name, so building the folder list from it offered `rootB/journal` while creating under root
 * A — which would have manufactured an `A/rootB/journal/` that exists nowhere. The URI is the
 * ground truth for where a note lives, so the list is derived from it instead.
 */
export function rootRelativeNotePaths(
  notes: readonly { readonly uri: string }[],
  rootUriPath: string,
): readonly { readonly path: string }[] {
  const root = rootUriPath.replace(/\/+$/, "");
  const paths: { readonly path: string }[] = [];
  for (const note of notes) {
    const notePath = uriPath(note.uri);
    if (notePath === undefined) continue;
    const relative = posix.relative(root, notePath);
    if (relative === "" || relative.startsWith("../") || posix.isAbsolute(relative)) continue;
    paths.push({ path: relative });
  }
  return paths;
}

/** The decoded path of a `file:` URI string, or `undefined` when it is not one. */
function uriPath(uri: string): string | undefined {
  try {
    const url = new URL(uri);
    return decodeURIComponent(url.pathname);
  } catch {
    return undefined;
  }
}

/**
 * A folder typed by hand, or `undefined` when it is not usable.
 *
 * Shares `normalizeWorkspaceRelativeFolder` with the setting so a typed folder and a configured
 * one cannot mean different things, and so `../` is refused in both.
 */
export function validateNoteFolder(value: string): string | undefined {
  try {
    normalizeWorkspaceRelativeFolder(value);
    return undefined;
  } catch (error) {
    return error instanceof Error
      ? error.message.replace("vispNotes.notesFolder", "The folder")
      : "That folder cannot be used.";
  }
}

function labelFor(path: string): { readonly label: string } {
  return { label: path === "" ? ROOT_LABEL : path };
}

/**
 * A misconfigured `notesFolder` must not stop a note being created — the picker is the place
 * that can offer somewhere else to put it.
 */
function safeNormalize(value: string): string {
  try {
    return normalizeWorkspaceRelativeFolder(value);
  } catch {
    return "";
  }
}
