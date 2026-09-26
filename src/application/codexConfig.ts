/**
 * Adding one MCP server to Codex's `config.toml`, without a TOML library and without
 * disturbing anything else in the file.
 *
 * Codex keeps its servers as tables, `[mcp_servers.<name>]`, in a file the reader also edits
 * by hand, so the edit is textual and minimal: an existing table for this server is replaced
 * in place — its header and every line up to the next table header — and otherwise the table
 * is appended. Comments, ordering and every other table are left exactly as they were.
 */

export interface CodexServer {
  readonly command: string;
  readonly args: readonly string[];
}

export function upsertCodexServer(toml: string, name: string, server: CodexServer): string {
  const table = [
    `[mcp_servers.${bareKey(name)}]`,
    `command = ${tomlString(server.command)}`,
    `args = [${server.args.map(tomlString).join(", ")}]`,
  ];
  const lines = toml.split(/\r?\n/);
  const newline = toml.includes("\r\n") ? "\r\n" : "\n";
  const start = lines.findIndex((line) => isHeaderFor(line, name));
  if (start >= 0) {
    let end = start + 1;
    while (end < lines.length && !/^\s*\[/.test(lines[end] ?? "")) end += 1;
    // Blank lines that separated the old table from the next one stay where they were.
    while (end > start + 1 && (lines[end - 1] ?? "").trim() === "") end -= 1;
    lines.splice(start, end - start, ...table);
    return lines.join(newline);
  }
  const body = toml.replace(/\s*$/, "");
  return `${body === "" ? "" : `${body}${newline}${newline}`}${table.join(newline)}${newline}`;
}

/** `[mcp_servers.visp-notes]`, quoted or not, with any spacing TOML allows. */
function isHeaderFor(line: string, name: string): boolean {
  const match = /^\s*\[\s*mcp_servers\s*\.\s*("(?:[^"\\]|\\.)*"|'[^']*'|[A-Za-z0-9_-]+)\s*\]\s*(#.*)?$/.exec(line);
  if (match === null) return false;
  const key = match[1] ?? "";
  const unquoted = key.startsWith('"') || key.startsWith("'") ? key.slice(1, -1) : key;
  return unquoted === name;
}

function bareKey(name: string): string {
  return /^[A-Za-z0-9_-]+$/.test(name) ? name : tomlString(name);
}

/** A TOML string. Literal (single-quoted) where it can be, so Windows paths need no escaping. */
export function tomlString(value: string): string {
  if (!value.includes("'") && !/[\n\r]/.test(value)) return `'${value}'`;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r")}"`;
}
