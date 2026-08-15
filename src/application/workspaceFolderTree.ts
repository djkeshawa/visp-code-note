/**
 * The folder tree the workspace panel draws.
 *
 * The panel used to count only the first path segment, so a vault organised
 * `projects/2026/alpha/notes.md` showed one `projects` row holding 1,800 notes: opening it
 * listed all 1,800 flat, in path order, with nothing to collapse, and the list then cut off at
 * the row limit and told the reader to go and type instead. Browsing had failed at the first
 * click.
 *
 * So a row exists for every distinct folder path, and an expanded folder draws only its
 * *children* — its subfolders and the notes directly inside it. That is strictly fewer rows
 * than the old subtree flattening, which is the point: the limit stops being the first thing a
 * reader meets.
 */

export interface WorkspaceFolderNode {
  /** Workspace-relative, `/`-separated, never empty and never trailing a slash. */
  readonly path: string;
  /** The last segment, which is what the row shows — the rest is said by the indentation. */
  readonly label: string;
  /** Notes anywhere beneath it, so a collapsed folder still reports what it holds. */
  readonly count: number;
  /** How many folders are above it; `0` at the workspace root. */
  readonly depth: number;
  /** The path of the folder above, absent at depth `0`. */
  readonly parent?: string;
}

/**
 * One row per distinct folder path, in the order a tree walks them.
 *
 * Every ancestor gets a row even when no note sits directly in it: a vault whose only note is
 * `a/b/c/note.md` still has an `a` to open, and a subtree reachable only through a folder that
 * was never emitted would be unreachable from the panel entirely.
 */
export function folderTreeRows(
  notes: readonly { readonly path: string }[],
): readonly WorkspaceFolderNode[] {
  const counts = new Map<string, number>();
  for (const note of notes) {
    const segments = note.path.split("/").slice(0, -1);
    let prefix = "";
    for (const segment of segments) {
      if (segment === "") continue;
      prefix = prefix === "" ? segment : `${prefix}/${segment}`;
      counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort(([left], [right]) => compareFolderPaths(left, right))
    .map(([path, count]) => folderNode(path, count));
}

function folderNode(path: string, count: number): WorkspaceFolderNode {
  const cut = path.lastIndexOf("/");
  return {
    path,
    label: cut === -1 ? path : path.slice(cut + 1),
    count,
    depth: cut === -1 ? 0 : path.split("/").length - 1,
    ...(cut === -1 ? {} : { parent: path.slice(0, cut) }),
  };
}

/*
 * `localeCompare` pays collator setup on every call, and this sorts every folder in the vault
 * on every publish. Segment by segment rather than whole strings, so that a folder always
 * sorts directly above its own children: `a-b` and `a/b` compare on `-` against `/` as whole
 * strings, which interleaves an unrelated folder into the middle of a subtree.
 */
const folderCollator = new Intl.Collator(undefined, { sensitivity: "base" });

function compareFolderPaths(left: string, right: string): number {
  const leftSegments = left.split("/");
  const rightSegments = right.split("/");
  const shared = Math.min(leftSegments.length, rightSegments.length);
  for (let index = 0; index < shared; index += 1) {
    const order = folderCollator.compare(
      leftSegments[index] ?? "",
      rightSegments[index] ?? "",
    );
    if (order !== 0) return order;
  }
  return leftSegments.length - rightSegments.length;
}

/**
 * A row about to be drawn, carrying the depth it is drawn *at* rather than the depth its path
 * implies. The two agree in every ordinary tree; they part when a folder arrives without its
 * parent, and it is the drawn depth that has to match the indentation on screen.
 */
export type WorkspaceTreeRow<Note> =
  | { readonly kind: "folder"; readonly folder: WorkspaceFolderNode; readonly depth: number }
  | { readonly kind: "note"; readonly note: Note; readonly depth: number };

/**
 * What the panel draws for the whole tree, top to bottom: every folder that is reachable
 * through open folders, the notes directly inside the open ones, and finally the notes at the
 * workspace root.
 *
 * Subfolders come before a folder's own notes, the way an explorer lists them, so that opening
 * a folder shows its shape before its contents.
 */
export function workspaceTreeRows<Note extends { readonly folder: string }>(
  folders: readonly WorkspaceFolderNode[],
  notes: readonly Note[],
  isExpanded: (path: string) => boolean,
): readonly WorkspaceTreeRow<Note>[] {
  const known = new Set(folders.map((folder) => folder.path));
  const children = new Map<string, WorkspaceFolderNode[]>();
  for (const folder of folders) {
    /*
     * A folder whose parent never arrived is drawn at the root rather than dropped: a subtree
     * reachable only through a row nobody sent would be invisible with no way to ask for it.
     */
    const under = folder.parent !== undefined && known.has(folder.parent) ? folder.parent : "";
    const siblings = children.get(under);
    if (siblings === undefined) children.set(under, [folder]);
    else siblings.push(folder);
  }

  const notesByFolder = new Map<string, Note[]>();
  for (const note of notes) {
    const siblings = notesByFolder.get(note.folder);
    if (siblings === undefined) notesByFolder.set(note.folder, [note]);
    else siblings.push(note);
  }

  const rows: WorkspaceTreeRow<Note>[] = [];
  appendFolders("", 0);
  for (const note of notesByFolder.get("") ?? []) rows.push({ kind: "note", note, depth: 0 });
  return rows;

  function appendFolders(parent: string, depth: number): void {
    for (const folder of children.get(parent) ?? []) {
      rows.push({ kind: "folder", folder, depth });
      if (!isExpanded(folder.path)) continue;
      appendFolders(folder.path, depth + 1);
      for (const note of notesByFolder.get(folder.path) ?? []) {
        rows.push({ kind: "note", note, depth: depth + 1 });
      }
    }
  }
}
