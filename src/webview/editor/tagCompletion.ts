/**
 * The `#` menu as a completion source, alongside the wiki-link and slash ones.
 *
 * Shaped like `wikiCompletion` on purpose: the same guard against fenced code and frontmatter,
 * and the same `filter: false` because the ranking in `tagSuggestionModel` is the ranking.
 *
 * What it will not do is as important as what it will. A `#` inside a wiki link is a heading
 * reference, inside a URL it is a fragment, and inside inline code it is a character — all of
 * which the spell checker already refuses to treat as prose, so the same ranges answer here
 * rather than a second opinion about them.
 */
import type {
  Completion,
  CompletionContext,
  CompletionResult,
  CompletionSource,
} from "@codemirror/autocomplete";
import { isProtectedMarkdownPosition } from "./markdownContext.js";
import { nonTagRanges } from "./proseRanges.js";
import { findTagQuery, rankTagSuggestions } from "./tagSuggestionModel.js";
import { findWikiQuery } from "./wikiSuggestionModel.js";

/** The tag name rides in `type`, so the row can be drawn in that tag's own hue. */
export const TAG_COMPLETION_TYPE = "visp-tag:";

/** How many rows the menu will show. A vocabulary can be long; a menu that is, is a list. */
const MAX_TAG_ROWS = 50;

export function createTagCompletionSource(tags: () => readonly string[]): CompletionSource {
  return (context) => tagCompletions(context, tags());
}

export function tagCompletions(
  context: CompletionContext,
  tags: readonly string[],
): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos);
  const prefix = context.state.sliceDoc(line.from, context.pos);
  const query = findTagQuery(prefix);
  if (query === undefined) return null;

  /*
   * A bare `#` at the start of a line is how an ATX heading starts, and a menu that opened on
   * every `# ` would be in the way of the most common line in a note. Typing one character of
   * a name says it is a tag; so does asking for the menu outright, which is what `/tag` does.
   */
  if (query.opensLine && query.query === "" && !context.explicit) return null;

  const start = line.from + query.start;
  if (isProtectedMarkdownPosition(context.state, start)) return null;
  /*
   * `[[Note#Heading` — the note picker owns this `#`, and it is still unclosed while it is
   * being typed, so the finished-link ranges below cannot see it. Asked of the wiki source's
   * own query rather than re-derived.
   */
  if (findWikiQuery(prefix, prefix.length, prefix.length) !== undefined) return null;
  /*
   * The backstop. Measured against the cases above, the two guards before this one already
   * decide every shape found — but note text is attacker-controlled, the list is the spell
   * checker's own and costs one pass over one line, and it is only ever reached while a tag is
   * actually being typed. Cheap insurance against a shape nobody enumerated.
   */
  if (nonTagRanges(context.state, line.from, line.to, line.text)
    .some((range) => range.start <= start && start < range.end)) {
    return null;
  }

  const options = rankTagSuggestions(tags, query.query)
    .slice(0, MAX_TAG_ROWS)
    .map((suggestion): Completion => ({
      label: `#${suggestion.name}`,
      // Named outright, because this row is the only warning a writer gets that the name they
      // are typing is not the one the workspace already uses.
      displayLabel: suggestion.create ? `Create #${suggestion.name}` : `#${suggestion.name}`,
      type: `${TAG_COMPLETION_TYPE}${suggestion.name}`,
      apply: `#${suggestion.name}`,
    }));

  return { from: start, to: context.pos, options, filter: false };
}
