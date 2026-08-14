import type { MarkdownBlock, OffsetRange, ParsedNote, WikiLink } from "../domain/models";
import { parseBlocks } from "./blocks";
import { parseBlockReferences } from "./blockReferences";
import { findHtmlCommentRanges } from "./comments";
import { parseFrontmatter } from "./frontmatter";
import { escapeFlags } from "./escapes";
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
  const written = writtenTitle({
    ...(frontmatter.data === undefined ? {} : { frontmatter: frontmatter.data }),
    headings: parsedBlocks.headings,
  });

  return Object.freeze({
    ...(written === undefined ? {} : { title: written }),
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

/**
 * The title a note writes down for itself, as opposed to the one it borrows from its file name.
 *
 * `NoteRecord.title` conflates the two — it falls back to the file stem — and that is the wrong
 * answer for anyone asking what a note will be called once its file is renamed. A note with a
 * `title:` or an `# H1` keeps its name through a rename and every `[[link]]` by title survives;
 * a note without one is renamed by the gesture, and those links have to be rewritten.
 */
export function writtenTitle(
  note: Pick<ParsedNote, "frontmatter" | "headings">,
): string | undefined {
  return readString(note.frontmatter, "title")
    ?? note.headings.find((heading) => heading.level === 1 && heading.text.trim() !== "")?.text;
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
  const escaped = escapeFlags(source);
  const protectedRanges = collectProtectedRanges(source, structuralRanges, commentRanges, escaped);
  const links = parseWikiLinks(source, protectedRanges, escaped);
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
