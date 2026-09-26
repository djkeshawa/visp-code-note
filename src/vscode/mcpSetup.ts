import { homedir } from "node:os";
import { join } from "node:path";
import * as vscode from "vscode";
import { upsertCodexServer } from "../application/codexConfig";

const SERVER_FILE = "visp-notes-mcp.js";
const SERVER_KEY = "visp-notes";

/**
 * Where agents outside VS Code find the MCP server.
 *
 * The extension's own folder has its version in its name, so a path into it breaks on every
 * update and every agent config pointing at it would silently stop working. The server is a
 * single self-contained file, so it is copied to the extension's global storage — a path that
 * outlives updates — and refreshed there whenever the bundled copy differs.
 */
export async function installMcpServer(context: vscode.ExtensionContext): Promise<vscode.Uri> {
  const source = vscode.Uri.joinPath(context.extensionUri, "out", "mcp", SERVER_FILE);
  const target = vscode.Uri.joinPath(context.globalStorageUri, SERVER_FILE);
  const bundled = await vscode.workspace.fs.readFile(source);
  const installed = await vscode.workspace.fs.readFile(target).then((bytes) => bytes, () => undefined);
  if (installed === undefined || Buffer.compare(Buffer.from(installed), Buffer.from(bundled)) !== 0) {
    await vscode.workspace.fs.createDirectory(context.globalStorageUri);
    await vscode.workspace.fs.writeFile(target, bundled);
  }
  return target;
}

interface ServerEntry {
  readonly command: string;
  readonly args: readonly string[];
}

function serverEntry(server: vscode.Uri, root: vscode.Uri): ServerEntry {
  return { command: "node", args: [server.fsPath, "--root", root.fsPath] };
}

/**
 * Connects an agent outside VS Code to these notes: Claude Code and Cursor get the server added
 * to their project config file, merged with whatever servers are already there; Codex gets it in
 * its own config file after asking; anything else gets the configuration on the clipboard. Only
 * the file the reader picked is written.
 */
export async function connectAgents(context: vscode.ExtensionContext): Promise<void> {
  const folder = await pickFolder();
  if (folder === undefined) return;
  const server = await installMcpServer(context);
  const entry = serverEntry(server, folder.uri);

  const codexConfig = vscode.Uri.file(join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "config.toml"));
  const choice = await vscode.window.showQuickPick([
    { label: "Claude Code", description: "Add to .mcp.json in this folder — the terminal and the VS Code extension", target: ".mcp.json" },
    { label: "Codex", description: `Add to ${codexConfig.fsPath} — the CLI and the VS Code extension`, target: "codex" },
    { label: "Cursor", description: "Add to .cursor/mcp.json in this folder", target: ".cursor/mcp.json" },
    { label: "Another MCP client", description: "Copy the configuration to the clipboard", target: undefined },
  ], { title: "Connect AI agents to your notes", placeHolder: "Which agent should read these notes?" });
  if (choice === undefined) return;

  if (choice.target === "codex") {
    await connectCodex(codexConfig, entry);
    return;
  }

  if (choice.target === undefined) {
    await vscode.env.clipboard.writeText(JSON.stringify({ mcpServers: { [SERVER_KEY]: entry } }, null, 2));
    void vscode.window.showInformationMessage(
      "Copied. Paste it into your MCP client's configuration; the server needs Node.js 18 or newer on the PATH.",
    );
    return;
  }

  const file = vscode.Uri.joinPath(folder.uri, ...choice.target.split("/"));
  const existing = await vscode.workspace.fs.readFile(file).then((bytes) => new TextDecoder().decode(bytes), () => "");
  let config: Record<string, unknown> = {};
  if (existing.trim() !== "") {
    try {
      const parsed: unknown = JSON.parse(existing);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not an object");
      config = parsed as Record<string, unknown>;
    } catch {
      void vscode.window.showErrorMessage(`${choice.target} is not valid JSON, so it was left alone. Fix it, or use "Another MCP client" to copy the configuration.`);
      return;
    }
  }
  const servers = typeof config.mcpServers === "object" && config.mcpServers !== null
    ? config.mcpServers as Record<string, unknown>
    : {};
  config = { ...config, mcpServers: { ...servers, [SERVER_KEY]: entry } };
  await vscode.workspace.fs.writeFile(file, new TextEncoder().encode(`${JSON.stringify(config, null, 2)}\n`));

  const open = await vscode.window.showInformationMessage(
    `${choice.label} can now read these notes through the "${SERVER_KEY}" MCP server. ` +
    `${choice.target} holds paths on this machine, so keep it out of version control. Restart ${choice.label} to pick it up.`,
    "Open File",
  );
  if (open === "Open File") await vscode.window.showTextDocument(file);
}

async function pickFolder(): Promise<vscode.WorkspaceFolder | undefined> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    void vscode.window.showInformationMessage("Open the folder that holds your notes first.");
    return undefined;
  }
  if (folders.length === 1) return folders[0];
  return vscode.window.showWorkspaceFolderPick({ placeHolder: "Which folder's notes should agents read?" });
}

/**
 * Codex keeps its servers in one config file in the home folder, shared by the CLI and the
 * VS Code extension, rather than per project. The file is the reader's own, so the edit only
 * adds or replaces the `visp-notes` table (see `codexConfig.ts`), and it is asked for first.
 * A server registered there serves this folder whichever project Codex is opened in.
 */
async function connectCodex(file: vscode.Uri, entry: ServerEntry): Promise<void> {
  const existing = await vscode.workspace.fs.readFile(file).then((bytes) => new TextDecoder().decode(bytes), () => "");
  const confirm = await vscode.window.showWarningMessage(
    `Add the "${SERVER_KEY}" MCP server to ${file.fsPath}? Only its own [mcp_servers.${SERVER_KEY}] table is added or replaced; the rest of the file is left as it is.`,
    { modal: true },
    "Add Server",
  );
  if (confirm !== "Add Server") return;
  await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(file, ".."));
  await vscode.workspace.fs.writeFile(file, new TextEncoder().encode(upsertCodexServer(existing, SERVER_KEY, entry)));
  const open = await vscode.window.showInformationMessage(
    `Codex can now read these notes through the "${SERVER_KEY}" MCP server. Start a new Codex session to pick it up.`,
    "Open File",
  );
  if (open === "Open File") await vscode.window.showTextDocument(file);
}
