export function matchesAnyGlob(path: string, patterns: readonly string[]): boolean {
  const normalizedPath = normalizePath(path);
  return patterns.some((pattern) =>
    expandBraces(normalizePath(pattern)).some((expanded) => globToRegExp(expanded).test(normalizedPath)),
  );
}

function globToRegExp(pattern: string): RegExp {
  const normalized = normalizePath(pattern).replace(/^\.\//, "").replace(/^\//, "");
  let source = "^";

  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    if (character === undefined) {
      break;
    }

    if (character === "*") {
      const isGlobStar = normalized[index + 1] === "*";
      if (!isGlobStar) {
        source += "[^/]*";
        continue;
      }

      while (normalized[index + 1] === "*") {
        index += 1;
      }
      if (normalized[index + 1] === "/") {
        index = skipRedundantGlobStars(normalized, index + 1);
        source += "(?:.*/)?";
      } else {
        source += ".*";
      }
      continue;
    }

    if (character === "?") {
      source += "[^/]";
      continue;
    }

    if (character === "[") {
      const end = normalized.indexOf("]", index + 1);
      if (end !== -1) {
        const body = normalized.slice(index + 1, end);
        const negated = body.startsWith("!");
        const classBody = (negated ? body.slice(1) : body)
          .replace(/\\/g, "\\\\")
          .replace(/^\^/, "\\^");
        if (classBody.length > 0) {
          source += `[${negated ? "^" : ""}${classBody}]`;
          index = end;
          continue;
        }
      }
    }

    source += escapeRegex(character);
  }

  return new RegExp(`${source}$`);
}

/**
 * Consumes any further globstar directory segments chained onto the one just read, and returns
 * the offset of the slash that ends the run.
 *
 * A globstar directory segment already means "any run of directories, including none", so a
 * chain of them matches exactly what a single one matches. Emitting a group apiece instead
 * leaves optional `.*` groups that can each match the same text, and the engine then tries every
 * way of dividing the path between them. That is exponential in the length of the chain: twelve
 * segments took fifteen seconds against one ordinary path and fourteen took a hundred. This
 * setting is workspace-scoped, so a cloned repository writes these, and the match runs on the
 * extension host for every keystroke in a Markdown file — so the chain collapses to the one
 * group it is equivalent to. Changing how the group itself is written does not help; only
 * collapsing the run removes the ambiguity.
 */
function skipRedundantGlobStars(pattern: string, slashIndex: number): number {
  let cursor = slashIndex;
  while (pattern[cursor + 1] === "*" && pattern[cursor + 2] === "*") {
    let next = cursor + 1;
    while (pattern[next] === "*") {
      next += 1;
    }
    if (pattern[next] !== "/") {
      break;
    }
    cursor = next;
  }
  return cursor;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

/**
 * How many patterns one exclude entry may expand into.
 *
 * `{a,b}` doubles the result for every group, so a pattern is free to ask for two to the power
 * of however many groups it contains. `vispNotes.exclude` is workspace-scoped, which means a
 * cloned repository supplies these, and twenty groups was already a million patterns and twelve
 * seconds of work per file. Beyond the ceiling the entry is refused rather than expanded: an
 * exclude nobody could have written by hand should not be able to stall opening a folder.
 */
const MAX_BRACE_EXPANSIONS = 1024;

function expandBraces(pattern: string): readonly string[] {
  const expanded = expandBracesWithin(pattern, { remaining: MAX_BRACE_EXPANSIONS });
  return expanded ?? [];
}

function expandBracesWithin(
  pattern: string,
  budget: { remaining: number },
): readonly string[] | undefined {
  const opening = pattern.indexOf("{");
  const closing = opening === -1 ? -1 : matchingBrace(pattern, opening);
  if (opening === -1 || closing === -1) {
    if (budget.remaining <= 0) return undefined;
    budget.remaining -= 1;
    return [pattern];
  }

  const prefix = pattern.slice(0, opening);
  const suffix = pattern.slice(closing + 1);
  const results: string[] = [];
  for (const alternative of splitAlternatives(pattern.slice(opening + 1, closing))) {
    const branch = expandBracesWithin(`${prefix}${alternative}${suffix}`, budget);
    if (branch === undefined) return undefined;
    results.push(...branch);
  }
  return results;
}

function matchingBrace(pattern: string, opening: number): number {
  let depth = 0;
  for (let index = opening; index < pattern.length; index += 1) {
    if (pattern[index] === "{") depth += 1;
    if (pattern[index] === "}" && --depth === 0) return index;
  }
  return -1;
}

function splitAlternatives(body: string): readonly string[] {
  const alternatives: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < body.length; index += 1) {
    if (body[index] === "{") depth += 1;
    if (body[index] === "}") depth -= 1;
    if (body[index] === "," && depth === 0) {
      alternatives.push(body.slice(start, index));
      start = index + 1;
    }
  }
  alternatives.push(body.slice(start));
  return alternatives;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
