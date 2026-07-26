import type { OffsetTextEdit } from "./textEdits";
import { parseMarkdown } from "../markdown/parser";
import { findFrontmatterBounds, findYamlProperty, formatYamlScalar } from "./yamlEdits";
import {
  assertSimpleYamlScalar,
  assertSimpleInlineYamlSequence,
  assertSingleLineYamlValue,
  decodeYamlScalar,
  planSimpleYamlSequenceAppend,
  planSimpleYamlSequenceRemoval,
  preferredLineEnding,
  readSimpleInlineSequence,
} from "./yamlSafety";

export function planTitleChange(source: string, nextTitle: string): OffsetTextEdit | undefined {
  const parsed = parseMarkdown(source);
  const frontmatter = findFrontmatterBounds(source);
  const titleProperty = frontmatter
    ? findYamlProperty(source, frontmatter, "title")
    : undefined;
  if (frontmatter && titleProperty) {
    if (titleProperty.value === "") {
      assertSingleLineYamlValue(source, frontmatter, titleProperty, "title");
    } else {
      assertSimpleYamlScalar(source, frontmatter, titleProperty, "title");
    }
    return {
      start: titleProperty.valueStart,
      end: titleProperty.valueEnd,
      text: [
        source[titleProperty.valueStart - 1] === ":" ? " " : "",
        formatYamlScalar(nextTitle, titleProperty.value),
        source[titleProperty.valueEnd] === "#" ? " " : "",
      ].join(""),
    };
  }

  const heading = parsed.headings.find((candidate) => candidate.level === 1);
  if (!heading || !heading.text) {
    const encodedTitle = formatYamlScalar(nextTitle, "");
    if (frontmatter) {
      return {
        start: frontmatter.contentEnd,
        end: frontmatter.contentEnd,
        text: `title: ${encodedTitle}${preferredLineEnding(source)}`,
      };
    }
    const start = source.startsWith("\uFEFF") ? 1 : 0;
    return { start, end: start, text: `# ${nextTitle}${preferredLineEnding(source)}${preferredLineEnding(source)}` };
  }

  const headingSource = source.slice(heading.range.start, heading.range.end);
  const titleOffset = headingSource.indexOf(heading.text);
  if (titleOffset === -1) {
    return undefined;
  }
  const start = heading.range.start + titleOffset;
  return { start, end: start + heading.text.length, text: nextTitle };
}

export function planAliasAddition(source: string, alias: string): OffsetTextEdit {
  const encodedAlias = JSON.stringify(alias);
  const eol = preferredLineEnding(source);
  const frontmatter = findFrontmatterBounds(source);

  if (!frontmatter) {
    const start = source.startsWith("\uFEFF") ? 1 : 0;
    return {
      start,
      end: start,
      text: `---${eol}aliases:${eol}  - ${encodedAlias}${eol}---${eol}${eol}`,
    };
  }

  const aliases = findYamlProperty(source, frontmatter, "aliases");
  if (!aliases) {
    return {
      start: frontmatter.contentEnd,
      end: frontmatter.contentEnd,
      text: `aliases:${eol}  - ${encodedAlias}${eol}`,
    };
  }

  const value = aliases.value;
  if (value.startsWith("[") && value.endsWith("]")) {
    assertSimpleInlineYamlSequence(source, frontmatter, aliases, "aliases list");
    const items = parseMarkdown(source).aliases.map((item) => JSON.stringify(item));
    const replacement = `[${[...items, encodedAlias].join(", ")}]`;
    return { start: aliases.valueStart, end: aliases.valueEnd, text: replacement };
  }
  if (value !== "") {
    assertSimpleYamlScalar(source, frontmatter, aliases, "aliases value");
    const existing = parseMarkdown(source).aliases[0] ?? value;
    return {
      start: aliases.valueStart,
      end: aliases.valueEnd,
      text: `[${JSON.stringify(existing)}, ${encodedAlias}]`,
    };
  }
  return planSimpleYamlSequenceAppend(source, frontmatter, aliases, encodedAlias);
}

/**
 * Tag editing is deliberately frontmatter-only.
 *
 * A tag can also be written inline as `#tag` in the prose, and the note's tag list merges
 * both sources. Rewriting a sentence to add or drop a tag would edit the author's words,
 * which is exactly the surprise a Markdown-first tool should not spring. So these planners
 * only ever touch the `tags:` property, and the UI shows which tags it can act on.
 */
const TAG_LABEL = "tags sequence";

export function planTagAddition(source: string, tag: string): OffsetTextEdit {
  const encoded = JSON.stringify(tag);
  const eol = preferredLineEnding(source);
  const frontmatter = findFrontmatterBounds(source);

  if (!frontmatter) {
    const start = source.startsWith("\uFEFF") ? 1 : 0;
    return {
      start,
      end: start,
      text: `---${eol}tags:${eol}  - ${encoded}${eol}---${eol}${eol}`,
    };
  }

  const tags = findYamlProperty(source, frontmatter, "tags");
  if (!tags) {
    return {
      start: frontmatter.contentEnd,
      end: frontmatter.contentEnd,
      text: `tags:${eol}  - ${encoded}${eol}`,
    };
  }

  const value = tags.value;
  if (value.startsWith("[") && value.endsWith("]")) {
    assertSimpleInlineYamlSequence(source, frontmatter, tags, "tags list");
    const items = (readSimpleInlineSequence(value) ?? []).filter((item) => item !== "");
    return {
      start: tags.valueStart,
      end: tags.valueEnd,
      text: `[${[...items, encoded].join(", ")}]`,
    };
  }
  if (value !== "") {
    // A single scalar becomes a two-item inline list rather than a second `tags:` key.
    assertSimpleYamlScalar(source, frontmatter, tags, "tags value");
    return {
      start: tags.valueStart,
      end: tags.valueEnd,
      text: `[${JSON.stringify(decodeYamlScalar(value))}, ${encoded}]`,
    };
  }
  return planSimpleYamlSequenceAppend(source, frontmatter, tags, encoded, TAG_LABEL);
}

/** Returns undefined when the tag is not in frontmatter, including when it is inline only. */
export function planTagRemoval(source: string, tag: string): OffsetTextEdit | undefined {
  const frontmatter = findFrontmatterBounds(source);
  if (!frontmatter) return undefined;
  const tags = findYamlProperty(source, frontmatter, "tags");
  if (!tags) return undefined;

  const matches = (candidate: string): boolean => sameTag(candidate, tag);
  const value = tags.value;

  if (value.startsWith("[") && value.endsWith("]")) {
    assertSimpleInlineYamlSequence(source, frontmatter, tags, "tags list");
    const items = (readSimpleInlineSequence(value) ?? []).filter((item) => item !== "");
    const kept = items.filter((item) => !matches(decodeYamlScalar(item)));
    if (kept.length === items.length) return undefined;
    return {
      start: tags.valueStart,
      end: tags.valueEnd,
      text: kept.length === 0 ? "[]" : `[${kept.join(", ")}]`,
    };
  }

  if (value !== "") {
    assertSimpleYamlScalar(source, frontmatter, tags, "tags value");
    if (!matches(decodeYamlScalar(value))) return undefined;
    // The only tag is going away, so leave an explicit empty list behind.
    return { start: tags.valueStart, end: tags.valueEnd, text: "[]" };
  }

  return planSimpleYamlSequenceRemoval(source, frontmatter, tags, matches, TAG_LABEL);
}

/** Tags compare case-insensitively, matching how the parser de-duplicates them. */
function sameTag(left: string, right: string): boolean {
  return left.trim().replace(/^#+/, "").toLocaleLowerCase() ===
    right.trim().replace(/^#+/, "").toLocaleLowerCase();
}
