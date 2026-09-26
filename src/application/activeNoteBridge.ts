import { isAbsolute, relative } from "node:path";

/**
 * Which note the reader has open, handed from VS Code to agents that run beside it.
 *
 * Claude Code and Codex learn "the current file" from VS Code's active text editor, and a note
 * open in the Visp Notes editor is not one, so they could not see it. Each VS Code window that
 * shows a note writes one small file naming it — the note's path, the moment, and the window's
 * process id — and the MCP server reads them. Only the path crosses; the note's text is read
 * from disk by the server like any other note, so nothing new is stored.
 *
 * Several windows may be open. The newest entry from a window that is still running, naming a
 * note inside the folder the server serves, wins; a window that crashed without removing its
 * file is recognised by its process being gone.
 */
export interface ActiveNoteEntry {
  /** Absolute file-system path of the note. */
  readonly file: string;
  /** When the window last showed it, in epoch milliseconds. */
  readonly at: number;
  /** The extension host's process id, so a window that is gone can be told apart. */
  readonly pid: number;
}

export const ACTIVE_NOTE_DIRECTORY = "active-note";

export function activeNoteFileName(pid: number): string {
  return `window-${pid}.json`;
}

export function parseActiveNoteEntry(text: string): ActiveNoteEntry | undefined {
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== "object" || value === null) return undefined;
    const { file, at, pid } = value as Record<string, unknown>;
    return typeof file === "string" && isAbsolute(file) &&
      typeof at === "number" && Number.isFinite(at) &&
      typeof pid === "number" && Number.isSafeInteger(pid) && pid > 0
      ? { file, at, pid }
      : undefined;
  } catch {
    return undefined;
  }
}

export function pickActiveNote(
  entries: readonly ActiveNoteEntry[],
  root: string,
  isRunning: (pid: number) => boolean,
): ActiveNoteEntry | undefined {
  return entries
    .filter((entry) => isInside(root, entry.file) && isRunning(entry.pid))
    .sort((left, right) => right.at - left.at)[0];
}

function isInside(root: string, file: string): boolean {
  const path = relative(root, file);
  return path !== "" && !path.startsWith("..") && !isAbsolute(path);
}

/** Whether a process id is still alive, without signalling it. */
export function processIsRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: it exists, it is just not ours to signal.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
