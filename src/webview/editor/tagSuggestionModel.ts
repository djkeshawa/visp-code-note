/**
 * The `#` menu: the workspace's own tag vocabulary, offered while the tag is being typed.
 *
 * Tags are load-bearing here — they carry a colour, a graph node, a Tasks grouping and a panel
 * section — and until now typing `#` in a note body got nothing at all. So `#project` and
 * `#projects` quietly became two tags with two hues and two graph nodes, and nothing ever said
 * so. Offering what already exists is half the answer; the other half is the row that says
 * "Create", because that is the moment a writer finds out the name they are typing is new.
 *
 * No `@codemirror` import here, so the query and the ranking are testable without an editor.
 */
import { collectTagNames } from "../../markdown/tags.js";

export interface TagQuery {
  /** Offset of the `#` within the line. */
  readonly start: number;
  readonly query: string;
  /** Nothing but indentation before the `#` — where an ATX heading also starts. */
  readonly opensLine: boolean;
}

export interface TagSuggestion {
  readonly name: string;
  /** True when the workspace has no tag by this name, and picking this row coins one. */
  readonly create: boolean;
}

/**
 * The `#…` the caret sits in, if there is one.
 *
 * A `#` is only the start of a tag where the parser would read one: at the beginning of a line
 * or after whitespace or an opening bracket. That rule is why this can be a completion source
 * at all — `C#`, `##` and a URL fragment all contain a hash and none of them wants a menu.
 */
export function findTagQuery(linePrefix: string): TagQuery | undefined {
  const hash = linePrefix.lastIndexOf("#");
  if (hash === -1) return undefined;

  // The name so far, which may still be empty or still be on a separator the finished tag
  // could not end on.
  const query = linePrefix.slice(hash + 1);
  if (!/^[\p{L}\p{N}_/-]*$/u.test(query)) return undefined;

  const before = linePrefix.slice(0, hash);
  if (before !== "" && !/[\s([{>]$/.test(before)) return undefined;
  return { start: hash, query, opensLine: /^[ \t]*$/.test(before) };
}

/**
 * The tags matching a query, best first, with the row that coins a new one last.
 *
 * Last on purpose. The nearest existing tag is what the menu opens on, so a writer typing
 * `#projects` where the workspace already says `#project` is shown the one they probably mean
 * and takes it with Enter; coining the second spelling costs one deliberate keystroke more
 * than reusing the first. That asymmetry is the whole point of the feature.
 */
export function rankTagSuggestions(
  tags: readonly string[],
  query: string,
): readonly TagSuggestion[] {
  const needle = query.trim().toLocaleLowerCase();
  const matches = needle === ""
    ? tags.map((name) => ({ name, score: 0 }))
    : tags
      .map((name) => ({ name, score: tagScore(name.toLocaleLowerCase(), needle) }))
      .filter((candidate) => candidate.score >= 0);

  // A stable sort, so tags scoring alike keep the order they arrived in — which is the order
  // the workspace actually uses them.
  const ranked = matches
    .map((candidate, index) => ({ ...candidate, index }))
    .sort((left, right) => left.score - right.score || left.index - right.index)
    .map((candidate): TagSuggestion => ({ name: candidate.name, create: false }));

  return canCoin(tags, query) ? [...ranked, { name: query, create: true }] : ranked;
}

/**
 * Whether the query names a tag that could be created: well formed by the parser's own rules,
 * and not one the workspace already has under any casing.
 */
function canCoin(tags: readonly string[], query: string): boolean {
  if (query === "") return false;
  // The grammar is not restated here — the parser is asked whether it would read this back.
  if (collectTagNames(`#${query}`)[0] !== query) return false;
  const needle = query.toLocaleLowerCase();
  return !tags.some((name) => name.toLocaleLowerCase() === needle);
}

/** Lower is better; negative means no match at all. */
function tagScore(name: string, needle: string): number {
  if (name.startsWith(needle)) return 0;
  // A nested tag is matched on any of its segments, so `#work/admin` answers to "admin".
  if (name.split("/").some((segment) => segment.startsWith(needle))) return 1;
  if (name.includes(needle)) return 2;
  /*
   * The query runs past an existing tag: typing `#projects` where the workspace already says
   * `#project`. Nothing above catches that — the shorter name neither starts with nor contains
   * the longer query — and it is precisely the split this source exists to prevent, so it is
   * matched explicitly rather than left to fall off the list.
   */
  if (needle.startsWith(name)) return 3;
  // Last resort, and what catches a typo: the letters in order but not together, so `#projet`
  // still finds `#project`.
  return isSubsequence(name, needle) ? 4 : -1;
}

function isSubsequence(name: string, needle: string): boolean {
  let position = -1;
  for (const character of needle) {
    position = name.indexOf(character, position + 1);
    if (position === -1) return false;
  }
  return true;
}
