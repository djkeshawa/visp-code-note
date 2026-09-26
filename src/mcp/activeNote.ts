import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseActiveNoteEntry, pickActiveNote, processIsRunning } from "../application/activeNoteBridge";
import type { ActiveNoteEntry } from "../application/activeNoteBridge";

/**
 * The note open in a VS Code window, for the MCP server — the reading half of
 * `activeNoteBridge.ts`. `directory` is where the extension's windows write, which for the
 * installed server is beside the server file itself in the extension's global storage.
 */
export async function readActiveNote(directory: string, root: string): Promise<ActiveNoteEntry | undefined> {
  const names = await readdir(directory).catch(() => [] as string[]);
  const entries: ActiveNoteEntry[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const entry = parseActiveNoteEntry(await readFile(join(directory, name), "utf8").catch(() => ""));
    if (entry !== undefined) entries.push(entry);
  }
  return pickActiveNote(entries, root, processIsRunning);
}
