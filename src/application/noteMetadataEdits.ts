import type { OffsetTextEdit } from "./textEdits";
import { parseMarkdown } from "../markdown/parser";
import { findFrontmatterBounds, findYamlProperty, formatYamlScalar } from "./yamlEdits";
import {
  assertSimpleYamlScalar,
  assertSimpleInlineYamlSequence,
  assertSingleLineYamlValue,
  planSimpleYamlSequenceAppend,
  preferredLineEnding,
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
