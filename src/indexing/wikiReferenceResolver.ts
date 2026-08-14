import type { NoteRecord, WikiLink } from "../domain/models";
import { decodeWikiTarget, slugifyHeading } from "../domain/normalization";
import { createNoteResolver } from "./noteResolver";

export type WikiReferenceResult =
  | {
      readonly status: "resolved";
      readonly note: NoteRecord;
      readonly offset?: number;
    }
  | {
      readonly status: "missing-note";
      readonly target: string;
    }
  | {
      readonly status: "missing-heading";
      readonly note: NoteRecord;
      readonly heading: string;
    }
  | {
      readonly status: "missing-block";
      readonly note: NoteRecord;
      readonly blockId: string;
    };

export interface WikiReferenceResolver {
  resolve(sourceUri: string, link: WikiLink): WikiReferenceResult;
}

/*
 * One resolver per index commit, shared by everyone asking about the same notes.
 *
 * Building one walks every note to index its path, title and aliases — 3.8ms over 2,000
 * notes on this machine. Six callers were each building their own: the note editor rebuilt
 * one for every keystroke, the document-link provider for every render of every open
 * Markdown file, diagnostics twice per change, and Find Broken Links once more. None of them
 * can move the answer, because a resolver reads nothing but the notes it was handed.
 *
 * The index publishes a fresh frozen `notes` array on every commit and never mutates one, so
 * the array itself is the statement "this resolver is still true" — and a WeakMap lets the
 * resolver be collected with the snapshot it belongs to rather than pinning the last vault
 * in memory for the life of the window.
 */
const resolvers = new WeakMap<readonly NoteRecord[], WikiReferenceResolver>();

/**
 * The shared resolver for a snapshot's notes. Prefer this to `createWikiReferenceResolver`
 * anywhere the notes come from the index; build your own only for a list you assembled.
 */
export function wikiReferenceResolverFor(
  notes: readonly NoteRecord[],
): WikiReferenceResolver {
  let resolver = resolvers.get(notes);
  if (resolver === undefined) {
    resolver = createWikiReferenceResolver(notes);
    resolvers.set(notes, resolver);
  }
  return resolver;
}

export function createWikiReferenceResolver(
  notes: readonly NoteRecord[],
): WikiReferenceResolver {
  const noteResolver = createNoteResolver(notes);
  return {
    resolve(sourceUri, link) {
      const note = noteResolver.resolve(sourceUri, link.target);
      if (note === undefined) {
        return { status: "missing-note", target: link.target };
      }

      const heading = link.heading === undefined ? undefined : decodeWikiTarget(link.heading);
      const headingRecord = heading === undefined
        ? undefined
        : note.headings.find((candidate) => candidate.slug === slugifyHeading(heading));
      if (heading !== undefined && headingRecord === undefined) {
        return { status: "missing-heading", note, heading };
      }

      const blockId = link.blockId === undefined ? undefined : decodeWikiTarget(link.blockId);
      const block = blockId === undefined
        ? undefined
        : note.blockReferences.find((candidate) => candidate.id === blockId);
      if (blockId !== undefined && block === undefined) {
        return { status: "missing-block", note, blockId };
      }

      const offset = block?.range.start ?? headingRecord?.range.start;
      return {
        status: "resolved",
        note,
        ...(offset === undefined ? {} : { offset }),
      };
    },
  };
}
