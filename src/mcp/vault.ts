import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import type { IndexSnapshot, NoteRecord, SkippedNote } from "../domain/models";
import { noteStem } from "../domain/normalization";
import { isWithinNoteSizeLimit, noteSizeLimitBytes } from "../application/noteSizeLimit";
import { matchesAnyGlob } from "../indexing/glob";
import { buildSnapshot } from "../indexing/projections";
import { createNoteProjector } from "../indexing/noteProjection";
import { parseMarkdown } from "../markdown/parser";

const DEFAULT_EXCLUDES = ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/out/**"];

interface VaultSettings {
  readonly excludes: readonly string[];
  readonly limitBytes: number | undefined;
}

interface CachedNote {
  readonly mtimeMs: number;
  readonly size: number;
  readonly record: NoteRecord;
}

/**
 * The notes in a folder, read straight from disk, for an agent running outside VS Code.
 *
 * It indexes exactly as the extension does — the same parser, the same projections, the same
 * `vispNotes.exclude` and `vispNotes.maxNoteSizeKB` read from the folder's
 * `.vscode/settings.json` — so an answer from Claude Code matches an answer from Copilot. There
 * is no file watcher: every question re-lists the folder and re-reads only files whose size or
 * modification time moved, which keeps answers current without a process that outlives its
 * client.
 */
export class Vault {
  private readonly cache = new Map<string, CachedNote>();
  private readonly projector = createNoteProjector();
  private last: { readonly key: string; readonly snapshot: IndexSnapshot } | undefined;
  private version = 0;

  public constructor(public readonly root: string) {}

  public async snapshot(): Promise<IndexSnapshot> {
    const settings = await readSettings(this.root);
    const files = await listMarkdown(this.root, settings.excludes);
    const notes: NoteRecord[] = [];
    const skipped: SkippedNote[] = [];
    const seen = new Set<string>();
    for (const file of files) {
      seen.add(file);
      const info = await stat(file).catch(() => undefined);
      if (info === undefined) continue;
      const path = relative(this.root, file).split(sep).join("/");
      if (!isWithinNoteSizeLimit(info.size, settings.limitBytes)) {
        skipped.push({ uri: pathToFileURL(file).href, path, sizeBytes: info.size, limitBytes: settings.limitBytes ?? info.size });
        continue;
      }
      const cached = this.cache.get(file);
      if (cached !== undefined && cached.mtimeMs === info.mtimeMs && cached.size === info.size) {
        notes.push(cached.record);
        continue;
      }
      const content = await readFile(file, "utf8").catch(() => undefined);
      if (content === undefined) continue;
      const parsed = parseMarkdown(content);
      const fileName = basename(file);
      const record: NoteRecord = {
        ...parsed,
        uri: pathToFileURL(file).href,
        path,
        fileName,
        title: parsed.title?.trim() || noteStem(fileName),
        ...(info.birthtimeMs > 0 ? { createdAt: info.birthtimeMs } : {}),
        modifiedAt: info.mtimeMs,
        content,
      };
      this.cache.set(file, { mtimeMs: info.mtimeMs, size: info.size, record });
      notes.push(record);
    }
    for (const file of this.cache.keys()) if (!seen.has(file)) this.cache.delete(file);

    // The projector and the snapshot are rebuilt only when some note actually changed.
    const key = notes.map((note) => `${note.uri}@${note.modifiedAt}`).join("\n") + `|${skipped.length}`;
    if (this.last?.key === key) return this.last.snapshot;
    const snapshot = buildSnapshot(notes, ++this.version, Date.now(), this.projector, skipped);
    this.last = { key, snapshot };
    return snapshot;
  }
}

async function listMarkdown(root: string, excludes: readonly string[]): Promise<string[]> {
  const found: string[] = [];
  const walk = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const absolute = join(directory, entry.name);
      const path = relative(root, absolute).split(sep).join("/");
      // Symbolic links are not followed, so a link back up the tree cannot loop the walk.
      if (entry.isDirectory()) {
        if (!matchesAnyGlob(`${path}/`, excludes) && !matchesAnyGlob(`${path}/x`, excludes)) await walk(absolute);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md") && !matchesAnyGlob(path, excludes)) {
        found.push(absolute);
      }
    }
  };
  await walk(root);
  return found.sort();
}

/** The extension's own settings for this folder, when it has a `.vscode/settings.json`. */
async function readSettings(root: string): Promise<VaultSettings> {
  const text = await readFile(join(root, ".vscode", "settings.json"), "utf8").catch(() => "");
  let settings: Record<string, unknown> = {};
  try {
    // VS Code settings are JSON with comments and trailing commas.
    const json = text
      .replace(/("(?:[^"\\]|\\.)*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (_match, string: string | undefined) => string ?? "")
      .replace(/,(\s*[}\]])/g, "$1");
    const parsed: unknown = json.trim() === "" ? {} : JSON.parse(json);
    if (typeof parsed === "object" && parsed !== null) settings = parsed as Record<string, unknown>;
  } catch {
    // An unreadable settings file leaves the defaults, exactly as it would in VS Code.
  }
  const exclude = settings["vispNotes.exclude"];
  return {
    excludes: Array.isArray(exclude) && exclude.every((pattern) => typeof pattern === "string")
      ? exclude.map((pattern: string) => pattern.trim()).filter(Boolean)
      : DEFAULT_EXCLUDES,
    limitBytes: noteSizeLimitBytes(settings["vispNotes.maxNoteSizeKB"]),
  };
}
