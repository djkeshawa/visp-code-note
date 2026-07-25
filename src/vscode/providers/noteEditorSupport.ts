import type { NoteRecord } from "../../domain/models";
import type { NoteSuggestion } from "../../domain/protocol";
import { decodeWikiTarget, encodeWikiTarget, slugifyHeading } from "../../domain/normalization";
import { createWikiTargetPlanner } from "../../indexing/noteResolver";

export function buildNoteSuggestions(
  notes: readonly NoteRecord[],
  sourceUri?: string,
): readonly NoteSuggestion[] {
  const planner = createWikiTargetPlanner(notes);
  return notes.map((note) => {
    const target = planner.targetFor(sourceUri, note);
    return {
      label: note.title,
      target,
      path: note.path,
      aliases: note.aliases,
      referenceTarget: note.uri === sourceUri ? "" : target,
      headings: unique(note.headings.map((heading) => heading.text)),
      blockIds: unique(note.blockReferences.map((reference) => reference.id)),
    };
  });
}

export function referenceOffset(
  note: NoteRecord,
  heading: string | undefined,
  blockId: string | undefined,
): number | undefined {
  if (blockId) {
    const decoded = decodeWikiTarget(blockId);
    return note.blockReferences.find((reference) => reference.id === decoded)?.range.start;
  }
  if (heading) {
    const slug = slugifyHeading(decodeWikiTarget(heading));
    return note.headings.find((candidate) => candidate.slug === slug)?.range.start;
  }
  return undefined;
}

export function headingTarget(heading: string): string {
  return encodeWikiTarget(heading);
}

function unique(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)]);
}
