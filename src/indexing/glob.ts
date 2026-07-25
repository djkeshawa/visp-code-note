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
        index += 1;
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

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function expandBraces(pattern: string): readonly string[] {
  const opening = pattern.indexOf("{");
  if (opening === -1) {
    return [pattern];
  }
  const closing = matchingBrace(pattern, opening);
  if (closing === -1) {
    return [pattern];
  }

  const prefix = pattern.slice(0, opening);
  const suffix = pattern.slice(closing + 1);
  return splitAlternatives(pattern.slice(opening + 1, closing)).flatMap((alternative) =>
    expandBraces(`${prefix}${alternative}${suffix}`),
  );
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
