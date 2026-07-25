const tagPattern = /(^|[\s([{>])#([\p{L}\p{N}_](?:[\p{L}\p{N}_/-]*[\p{L}\p{N}_])?)/gu;

export interface TagMatch {
  readonly name: string;
  readonly start: number;
  readonly end: number;
}

export function findTags(value: string, baseOffset = 0): readonly TagMatch[] {
  const matches: TagMatch[] = [];
  for (const match of value.matchAll(tagPattern)) {
    const tag = match[2];
    if (tag === undefined || match.index === undefined) {
      continue;
    }
    const start = baseOffset + match.index + (match[1]?.length ?? 0);
    matches.push({ name: tag, start, end: start + tag.length + 1 });
  }
  return matches;
}

export function collectTagNames(value: string): readonly string[] {
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const match of value.matchAll(tagPattern)) {
    const tag = match[2];
    if (tag === undefined) {
      continue;
    }
    const key = tag.toLocaleLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      tags.push(tag);
    }
  }
  return tags;
}

export function removeTagTokens(value: string): string {
  return value.replace(tagPattern, "$1");
}

export function mergeTagNames(...groups: readonly (readonly string[])[]): readonly string[] {
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const rawTag of group) {
      const tag = rawTag.trim().replace(/^#+/, "");
      const key = tag.toLocaleLowerCase();
      if (tag !== "" && !seen.has(key)) {
        seen.add(key);
        merged.push(tag);
      }
    }
  }
  return Object.freeze(merged);
}
