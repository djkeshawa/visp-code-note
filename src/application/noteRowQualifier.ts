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

interface Candidate {
  readonly uri: string;
  readonly path: string;
  /** The folder segments, split once. Splitting per depth per note made this quadratic twice. */
  readonly folders: readonly string[];
}

/** By note URI, for the notes whose titles are shared. Notes with a unique title are absent. */
export function noteRowQualifiers(
  notes: readonly QualifiableNote[],
): ReadonlyMap<string, string> {
  const byTitle = new Map<string, Candidate[]>();
  for (const note of notes) {
    const key = note.title.toLocaleLowerCase();
    const segments = note.path.split("/");
    const candidate: Candidate = {
      uri: note.uri,
      path: note.path,
      folders: segments.slice(0, -1),
    };
    const group = byTitle.get(key);
    if (group === undefined) byTitle.set(key, [candidate]);
    else group.push(candidate);
  }

  const qualifiers = new Map<string, string>();
  for (const group of byTitle.values()) {
    if (group.length > 1) assignQualifiers(group, qualifiers);
  }
  return qualifiers;
}

/**
 * The shortest distinguishing folder suffix for each note in one group.
 *
 * Counted rather than compared pairwise. Asking "does any other note in this group share this
 * suffix" for every note at every depth is quadratic, and a vault where a thousand notes carry
 * the same title is not hypothetical — measured at 2,000 such notes it took 2.1 seconds, on a
 * panel that re-renders while the reader is typing. Tallying each depth's suffixes once and
 * reading the answer off the tally is linear, and the same 2,000 notes take under 5ms.
 *
 * Notes leave the running as soon as they are separated, which cannot mislead the notes still
 * in it: a longer suffix of an already-unique suffix stays unique, and a note that is still
 * ambiguous differs from the departed one at a shallower depth already.
 */
function assignQualifiers(
  group: readonly Candidate[],
  qualifiers: Map<string, string>,
): void {
  let ambiguous = [...group];
  const deepest = Math.max(...group.map((note) => note.folders.length));

  for (let depth = 1; depth <= deepest && ambiguous.length > 0; depth += 1) {
    const tally = new Map<string, number>();
    for (const note of ambiguous) {
      const suffix = folderSuffix(note, depth);
      tally.set(suffix, (tally.get(suffix) ?? 0) + 1);
    }
    const stillAmbiguous: Candidate[] = [];
    for (const note of ambiguous) {
      const suffix = folderSuffix(note, depth);
      if (suffix !== "" && tally.get(suffix) === 1) qualifiers.set(note.uri, suffix);
      else stillAmbiguous.push(note);
    }
    ambiguous = stillAmbiguous;
  }

  /*
   * Same title, same folder: these notes differ only as files, so the file name is the only
   * thing left that tells them apart. Also the answer at the workspace root, where there is no
   * folder to name.
   */
  for (const note of ambiguous) {
    qualifiers.set(note.uri, note.path.split("/").at(-1) ?? note.path);
  }
}

function folderSuffix(note: Candidate, depth: number): string {
  return note.folders.slice(Math.max(0, note.folders.length - depth)).join("/");
}
