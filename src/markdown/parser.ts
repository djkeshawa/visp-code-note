import type { MarkdownBlock, OffsetRange, ParsedNote, WikiLink } from "../domain/models";
import { parseBlocks } from "./blocks";
import { parseBlockReferences } from "./blockReferences";
import { findHtmlCommentRanges } from "./comments";
import { parseFrontmatter } from "./frontmatter";
import { collectProtectedRanges, parseInlineTags, parseWikiLinks } from "./inline";
import { scanLines } from "./lines";
import { mergeTagNames } from "./tags";
import { parseTasks } from "./tasks";

export function parseMarkdown(source: string): ParsedNote {
  const analysis = analyzeMarkdownSource(source);
  const {
    lines,
    frontmatter,
    commentRanges,
    parsedBlocks,
    protectedRanges,
    links,
  } = analysis;
  const codeRanges = parsedBlocks.blocks
    .filter((block) => block.kind === "code")
    .map((block) => block.range);
  const blockReferences = parseBlockReferences(source, protectedRanges);
  const taskProtectedRanges = frontmatter.range === undefined
    ? [...codeRanges, ...commentRanges]
    : [...codeRanges, ...commentRanges, frontmatter.range];
  const tasks = parseTasks(source, lines, taskProtectedRanges);
  const frontmatterTags = readList(frontmatter.data, "tags");
  const tags = mergeTagNames(
    frontmatterTags,
    parseInlineTags(source, protectedRanges, links),
    ...tasks.map((task) => task.tags),
  );
  const configuredTitle = readString(frontmatter.data, "title");
  const headingTitle = parsedBlocks.headings.find(
    (heading) => heading.level === 1 && heading.text.trim() !== "",
  )?.text;

  return Object.freeze({
    ...(configuredTitle === undefined ? (headingTitle === undefined ? {} : { title: headingTitle }) : { title: configuredTitle }),
    aliases: Object.freeze([...readList(frontmatter.data, "aliases")]),
    headings: parsedBlocks.headings,
    blockReferences,
    links,
    tasks,
    tags,
    blocks: parsedBlocks.blocks,
    ...(frontmatter.data === undefined ? {} : { frontmatter: frontmatter.data }),
  });
}

export interface MarkdownWikiAnalysis {
  readonly protectedRanges: readonly OffsetRange[];
  readonly links: readonly WikiLink[];
  readonly blocks: readonly MarkdownBlock[];
  /** Present only when the source opens with a closed frontmatter block. */
  readonly frontmatterRange?: OffsetRange;
}

export function analyzeMarkdownWikiSyntax(source: string): MarkdownWikiAnalysis {
  const { protectedRanges, links, parsedBlocks, frontmatter } = analyzeMarkdownSource(source);
  return {
    protectedRanges,
    links,
    blocks: parsedBlocks.blocks,
    ...(frontmatter.range === undefined ? {} : { frontmatterRange: frontmatter.range }),
  };
}

function analyzeMarkdownSource(source: string) {
  const lines = scanLines(source);
  const frontmatter = parseFrontmatter(lines);
  const commentRanges = findHtmlCommentRanges(source);
  const parsedBlocks = parseBlocks(source, lines, frontmatter.lineCount, commentRanges);
  const codeRanges = parsedBlocks.blocks
    .filter((block) => block.kind === "code")
    .map((block) => block.range);
  const structuralRanges = frontmatter.range === undefined
    ? codeRanges
    : [...codeRanges, frontmatter.range];
  const protectedRanges = collectProtectedRanges(source, structuralRanges, commentRanges);
  const links = parseWikiLinks(source, protectedRanges);
  return { lines, frontmatter, commentRanges, parsedBlocks, protectedRanges, links };
}

function readString(
  frontmatter: Readonly<Record<string, string | readonly string[]>> | undefined,
  key: string,
): string | undefined {
  const value = frontmatter?.[key];
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function readList(
  frontmatter: Readonly<Record<string, string | readonly string[]>> | undefined,
  key: string,
): readonly string[] {
  const value = frontmatter?.[key];
  if (typeof value === "string") {
    return value.trim() === "" ? [] : [value.trim()];
  }
  return value?.map((item) => item.trim()).filter((item) => item !== "") ?? [];
}
