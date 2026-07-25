import type { NoteRecord } from "../../src/domain/models";
import { noteStem } from "../../src/domain/normalization";
import { parseMarkdown } from "../../src/markdown/parser";

interface NoteOptions {
  readonly path: string;
  readonly content?: string;
  readonly title?: string;
  readonly aliases?: readonly string[];
}

export function makeNote(options: NoteOptions): NoteRecord {
  const content = options.content ?? `# ${options.title ?? noteStem(options.path)}\n`;
  const parsed = parseMarkdown(content);
  const fileName = options.path.split("/").pop() ?? options.path;
  return {
    ...parsed,
    ...(options.aliases === undefined ? {} : { aliases: options.aliases }),
    uri: `file:///${options.path}`,
    path: options.path,
    fileName,
    title: options.title ?? parsed.title ?? noteStem(options.path),
    modifiedAt: 1,
    content,
  };
}
