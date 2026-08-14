/**
 * What a note row has to say beyond its title, when the title alone does not identify it.
 *
 * A row shows the note's title. Four `index.md` files under four projects all say `Index`, so
 * the filtered list draws four identical rows and the only way to tell them apart is to hover
 * each one in turn. Every row carrying its folder would be noise — most titles are unique, and
 * a sidebar has no width to spare — so only the ambiguous ones do.
 *
 * The qualifier is the shortest run of trailing folder segments that separates a note from the
 * others sharing its title: `alpha` when the collision is `2026/alpha` against `2026/beta`, and
 * `2026/alpha` when it is `2025/alpha` as well. Two notes titled the same *in the same folder*
 * differ only by file name, so that is what those rows show.
 */

export interface QualifiableNote {
  readonly uri: string;
  readonly title: string;
  /** Workspace-relative, including the file name. */
  readonly path: string;
}

/** By note URI, for the notes whose titles are shared. Notes with a unique title are absent. */
export function noteRowQualifiers(
  notes: readonly QualifiableNote[],
): ReadonlyMap<string, string> {
  const byTitle = new Map<string, QualifiableNote[]>();
  for (const note of notes) {
    const key = note.title.toLocaleLowerCase();
    const group = byTitle.get(key);
    if (group === undefined) byTitle.set(key, [note]);
    else group.push(note);
  }

  const qualifiers = new Map<string, string>();
  for (const group of byTitle.values()) {
    if (group.length < 2) continue;
    for (const note of group) qualifiers.set(note.uri, qualifierFor(note, group));
  }
  return qualifiers;
}

function qualifierFor(note: QualifiableNote, group: readonly QualifiableNote[]): string {
  const deepest = Math.max(...group.map((other) => other.path.split("/").length - 1));
  for (let depth = 1; depth <= deepest; depth += 1) {
    const suffix = folderSuffix(note.path, depth);
    if (suffix === "") continue;
    const shared = group.some(
      (other) => other.uri !== note.uri && folderSuffix(other.path, depth) === suffix,
    );
    if (!shared) return suffix;
  }
  /*
   * Same title, same folder: the notes differ only as files, so the file name is the only thing
   * left that tells them apart. Also the answer at the workspace root, where there is no folder.
   */
  return note.path.split("/").at(-1) ?? note.path;
}

function folderSuffix(path: string, depth: number): string {
  const segments = path.split("/").slice(0, -1);
  return segments.slice(Math.max(0, segments.length - depth)).join("/");
}
