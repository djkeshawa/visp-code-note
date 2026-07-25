import { pickedCompletion } from "@codemirror/autocomplete";
import type {
  Completion,
  CompletionContext,
  CompletionResult,
  CompletionSource,
} from "@codemirror/autocomplete";
import type { NoteSuggestionWire } from "../contracts.js";
import { isProtectedMarkdownPosition } from "./markdownContext.js";
import { findWikiQuery, rankSuggestions } from "./wikiSuggestionModel.js";

export function createWikiCompletionSource(
  suggestions: () => readonly NoteSuggestionWire[],
): CompletionSource {
  return (context) => wikiCompletions(context, suggestions());
}

export function wikiCompletions(
  context: CompletionContext,
  suggestions: readonly NoteSuggestionWire[],
): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos);
  const prefix = context.state.sliceDoc(line.from, context.pos);
  const query = findWikiQuery(prefix, prefix.length, prefix.length);
  if (query === undefined || isProtectedMarkdownPosition(context.state, context.pos)) return null;

  const options = rankSuggestions(suggestions, query.query)
    .slice(0, 50)
    .map((match): Completion => ({
      label: match.target,
      displayLabel: match.label,
      detail: match.kind === "note" ? match.path : `${capitalize(match.kind)} · ${match.path}`,
      type: match.kind === "note" ? "reference" : match.kind === "heading" ? "property" : "constant",
      apply: (view, completion, from, to) => {
        const suffix = view.state.sliceDoc(to, Math.min(view.state.doc.length, to + 2));
        const existingClosers = suffix.startsWith("]]") ? 2 : suffix.startsWith("]") ? 1 : 0;
        const insertion = `${match.target}${"]".repeat(2 - existingClosers)}`;
        const anchor = from + match.target.length + 2;
        view.dispatch({
          changes: { from, to, insert: insertion },
          selection: { anchor },
          annotations: pickedCompletion.of(completion),
          userEvent: "input.complete",
        });
      },
    }));

  return {
    from: line.from + query.start,
    to: context.pos,
    options,
    filter: false,
  };
}

function capitalize(value: string): string {
  return value.charAt(0).toLocaleUpperCase() + value.slice(1);
}
