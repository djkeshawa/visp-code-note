import type { GraphData, GraphNode, GraphNodeKind, IndexSnapshot } from "../domain/models";
import type { GraphSearchResult } from "../domain/protocol";
import { taskNodeId } from "../indexing/graphProjection";
import { createSearchRequest, lowercasePreservingLength, selectSearchMatch } from "./workspaceSearchMatcher";
import type { SearchCandidate, SearchMatch } from "./workspaceSearchMatcher";
import { hasSearchFilters, noteMatchesFilters, taskMatchesFilters } from "./workspaceSearchFilters";
import { narrowSearchableNotes, noteSearchCandidates, taskSearchCandidates } from "./workspaceSearchIndex";
import { sourceSearchSnippet, truncateSearchValue } from "./workspaceSearchPreview";

export interface GraphSearchOptions {
  readonly mode: "all" | "labels";
  readonly kinds: readonly GraphNodeKind[];
  readonly includeOrphans: boolean;
}

export interface GraphSearchPage {
  readonly nodeIds: readonly string[];
  readonly results: readonly GraphSearchResult[];
}

export function buildGraphSearch(
  snapshot: IndexSnapshot,
  graph: GraphData,
  query: string,
  options: GraphSearchOptions,
  limit = 100,
): GraphSearchPage {
  if (query.trim() === "") return { nodeIds: [], results: [] };
  const request = createSearchRequest(query);
  const filtered = hasSearchFilters(request.filters);
  const kinds = new Set(options.kinds);
  const notes = new Map(snapshot.notes.map((note) => [note.uri, note]));
  const tasks = new Map(snapshot.tasks.map((task) => [taskNodeId(task.noteUri, task.id, task.range.start), task]));
  const candidateUris = options.mode === "all" && request.terms.length > 0
    ? narrowSearchableNotes(snapshot.notes, request.terms) : undefined;
  const hits: SearchHit[] = [];

  for (const node of graph.nodes) {
    if (!kinds.has(node.kind) || (!options.includeOrphans && node.orphan === true)) continue;
    const note = node.uri === undefined ? undefined : notes.get(node.uri);
    const task = tasks.get(node.id);
    let candidates: readonly SearchCandidate[];
    if (node.kind === "note" && note !== undefined) {
      if (filtered && !noteMatchesFilters(request.filters, note)) continue;
      if (candidateUris !== undefined && !candidateUris.has(note.uri)) continue;
      candidates = options.mode === "all" ? noteSearchCandidates(note) : [labelCandidate(node)];
    } else if (node.kind === "task" && task !== undefined) {
      if (filtered && !taskMatchesFilters(request.filters, task, note)) continue;
      candidates = options.mode === "all" ? taskSearchCandidates(task) : [labelCandidate(node)];
    } else {
      // Path, date, and task facets describe indexed notes/tasks, not stand-alone tag or missing-link nodes.
      if (filtered) continue;
      candidates = [labelCandidate(node)];
    }
    const match = selectSearchMatch(candidates, request);
    if (match === undefined) continue;
    const start = task?.range.start ?? (match.candidate.sourceBacked
      ? match.candidate.sourceStart + match.index : note?.headings[0]?.range.start ?? 0);
    hits.push({ node, match, start, path: note?.path, source: note?.content, labels: options.mode === "labels" });
  }
  hits.sort((left, right) => right.match.score - left.match.score
    || collator.compare(left.node.label, right.node.label) || collator.compare(left.node.id, right.node.id));
  return {
    nodeIds: hits.map((hit) => hit.node.id),
    // Only the displayed results carry snippets; every match remains available for graph highlighting.
    results: hits.slice(0, Math.max(0, Math.floor(limit))).map(searchResult),
  };
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

interface SearchHit {
  readonly node: GraphNode;
  readonly match: SearchMatch;
  readonly start: number;
  readonly path?: string;
  readonly source?: string;
  readonly labels: boolean;
}

function labelCandidate(node: GraphNode): SearchCandidate {
  return { field: "title", value: node.label, lower: lowercasePreservingLength(node.label),
    weight: 800, sourceStart: 0, sourceBacked: false };
}

function searchResult(hit: SearchHit): GraphSearchResult {
  const field = hit.labels || hit.node.kind === "tag" || hit.node.kind === "unresolved"
    ? "label" : hit.match.candidate.field;
  return {
    nodeId: hit.node.id,
    matchedField: field,
    preview: field === "body" && hit.source !== undefined
      ? sourceSearchSnippet(hit.source, hit.start, hit.match.length)
      : truncateSearchValue(hit.match.candidate.value),
    ...(hit.path === undefined ? {} : { path: hit.path }),
    ...(hit.node.uri === undefined ? {} : { uri: hit.node.uri, start: hit.start }),
  };
}
