import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { AGENT_TOOLS, answerAgentTool } from "../application/agentTools";
import type { AgentToolName } from "../application/agentTools";
import { todayStamp } from "../vscode/providers/explorerModel";
import { Vault } from "./vault";

/**
 * Visp Notes as a Model Context Protocol server, for agents outside VS Code — Claude Code,
 * Cursor, and any other MCP client.
 *
 * It speaks MCP over stdio: one JSON-RPC message per line in, one per line out, and nothing
 * else on stdout. Only what the tools need is implemented — initialize, ping, tools/list and
 * tools/call — by hand rather than through the SDK, because the extension takes no runtime
 * dependencies (see THIRD_PARTY_NOTICES.md and `scripts/build-webviews.mjs` for why), and this
 * much protocol is smaller than the dependency would be.
 *
 * The tools are the ones Copilot gets inside VS Code, answered by the same code. The open-note
 * tool is left out: outside an editor there is no open note.
 */

export const SERVER_NAME = "visp-notes";
export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;

/** MCP tool names: what an MCP client shows the model, prefixed by the server's own name. */
const MCP_NAMES: Partial<Record<AgentToolName, string>> = {
  readNote: "read_note",
  searchNotes: "search_notes",
  noteGraph: "note_graph",
  linkPath: "link_path",
  listTasks: "list_tasks",
};

const INSTRUCTIONS =
  "These tools read the user's Markdown notes as a linked knowledge base: notes connect with " +
  "[[wiki links]], carry #tags, and hold `- [ ]` tasks with @due(...) dates. Use search_notes to " +
  "find notes, read_note for a note with its links and backlinks, note_graph to gather related " +
  "notes, link_path to see how two notes connect, and list_tasks for open or overdue work. " +
  "Answers give each note's workspace path; edit notes with your normal file tools.";

const DISABLED = "Agent access to these notes is turned off (vispNotes.agents.enabled is false in the folder's .vscode/settings.json).";

type JsonRpcId = string | number;

interface JsonRpcResponse {
  readonly jsonrpc: "2.0";
  readonly id: JsonRpcId | null;
  readonly result?: unknown;
  readonly error?: { readonly code: number; readonly message: string };
}

export async function handleMessage(
  message: unknown,
  vault: Vault,
  version: string,
  today: () => string = todayStamp,
): Promise<JsonRpcResponse | undefined> {
  if (typeof message !== "object" || message === null) return failure(null, -32600, "Invalid request");
  const { id, method, params } = message as { id?: unknown; method?: unknown; params?: unknown };
  // A notification — no id — is never answered, whatever it is.
  if (id === undefined) return undefined;
  if (typeof id !== "string" && typeof id !== "number") return failure(null, -32600, "Invalid request");
  if (typeof method !== "string") return failure(id, -32600, "Invalid request");
  const args = typeof params === "object" && params !== null ? params as Record<string, unknown> : {};

  switch (method) {
    case "initialize": {
      const requested = args.protocolVersion;
      const protocolVersion = typeof requested === "string" &&
        (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
        ? requested
        : SUPPORTED_PROTOCOL_VERSIONS[0];
      return success(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, title: "Visp Notes", version },
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return success(id, {});
    case "tools/list": {
      // A folder that has switched agent access off offers nothing to call.
      if (!(await vault.access()).enabled) return success(id, { tools: [] });
      return success(id, {
        tools: AGENT_TOOLS.flatMap((tool) => {
          const name = MCP_NAMES[tool.name];
          return name === undefined ? [] : [{
            name,
            title: tool.title,
            description: tool.description,
            inputSchema: tool.inputSchema,
            annotations: { readOnlyHint: true, openWorldHint: false },
          }];
        }),
      });
    }
    case "tools/call": {
      const tool = Object.entries(MCP_NAMES).find(([, name]) => name === args.name)?.[0] as AgentToolName | undefined;
      if (tool === undefined) return failure(id, -32602, `Unknown tool: ${String(args.name)}`);
      try {
        const access = await vault.access();
        if (!access.enabled) {
          return success(id, { content: [{ type: "text", text: DISABLED }], isError: true });
        }
        const snapshot = await vault.snapshot();
        const text = answerAgentTool(tool, args.arguments ?? {}, { snapshot, today: today(), exclude: access.exclude });
        return success(id, { content: [{ type: "text", text }], isError: false });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return success(id, { content: [{ type: "text", text: `Could not read the notes: ${reason}` }], isError: true });
      }
    }
    default:
      return failure(id, -32601, `Method not found: ${method}`);
  }
}

function success(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function failure(id: JsonRpcId | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

const USAGE = `Visp Notes MCP server

Usage: visp-notes-mcp [--root <folder>]

Serves the Markdown notes under <folder> (default: the current directory) to MCP clients
over stdio. Register it with your agent, for example in Claude Code:

  claude mcp add visp-notes -- node /path/to/visp-notes-mcp.js --root /path/to/notes
`;

export function run(argv: readonly string[], version: string): void {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(USAGE);
    return;
  }
  if (argv.includes("--version")) {
    process.stdout.write(`${version}\n`);
    return;
  }
  const rootIndex = argv.indexOf("--root");
  const root = resolve(rootIndex >= 0 && argv[rootIndex + 1] !== undefined ? argv[rootIndex + 1] ?? "." : ".");
  const vault = new Vault(root);
  process.stderr.write(`visp-notes MCP server ${version} serving ${root}\n`);

  // Replies go out in the order requests came in, even though answering is asynchronous.
  let queue = Promise.resolve();
  const lines = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });
  lines.on("line", (line) => {
    if (line.trim() === "") return;
    queue = queue.then(async () => {
      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch {
        write(failure(null, -32700, "Parse error"));
        return;
      }
      const reply = await handleMessage(message, vault, version);
      if (reply !== undefined) write(reply);
    });
  });
  lines.on("close", () => void queue.then(() => process.exit(0)));
}

function write(response: JsonRpcResponse): void {
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

declare const VISP_NOTES_VERSION: string | undefined;

if (require.main === module) {
  run(process.argv.slice(2), typeof VISP_NOTES_VERSION === "string" ? VISP_NOTES_VERSION : "dev");
}
