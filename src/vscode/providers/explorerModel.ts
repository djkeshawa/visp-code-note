import type { IndexSnapshot } from "../../domain/models";

/**
 * Shaping the index for the workspace panel.
 *
 * What is left here after the panel replaced the tree view: the two questions the panel asks
 * of the index that are not simply "list the notes" — how connected each note is, and what
 * counts as today.
 */

/**
 * How many other notes each note is connected to, which is what the panel's dot and count
 * report.
 *
 * Neighbours, not link occurrences. Linking the same note three times is one connection, and
 * an in-note anchor such as `[[#Heading]]` resolves to the note itself and is no connection
 * at all — counting rows made a note with two anchors and no outside links read as its
 * best-connected note. This is also the sense `getOrphanNotes` and the note inspector's
 * links-out list use, so the three cannot disagree about the same note.
 *
 * Counted once for the whole snapshot rather than per row.
 */
export function noteLinkCounts(snapshot: IndexSnapshot): ReadonlyMap<string, number> {
  const neighbours = new Map<string, Set<string>>();
  const connect = (from: string, to: string): void => {
    const existing = neighbours.get(from);
    if (existing === undefined) {
      neighbours.set(from, new Set([to]));
    } else {
      existing.add(to);
    }
  };
  for (const link of snapshot.links) {
    const target = link.targetUri;
    if (target === undefined || target === link.sourceUri) continue;
    connect(link.sourceUri, target);
    connect(target, link.sourceUri);
  }
  return new Map([...neighbours].map(([uri, set]) => [uri, set.size]));
}

export function todayStamp(now = new Date()): string {
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}
