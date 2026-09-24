import assert = require("node:assert/strict");
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { handleMessage } from "../../src/mcp/server";
import { Vault } from "../../src/mcp/vault";

let root: string;

before(async () => {
  root = await mkdtemp(join(tmpdir(), "visp-mcp-"));
  await mkdir(join(root, "notes"), { recursive: true });
  await mkdir(join(root, "archive"), { recursive: true });
  await mkdir(join(root, "node_modules", "pkg"), { recursive: true });
  await mkdir(join(root, ".vscode"), { recursive: true });
  await writeFile(join(root, "notes", "hub.md"), "# Hub\n\nSee [[Spoke]].\n\n- [ ] Ship it @due(2026-01-01)\n");
  await writeFile(join(root, "notes", "spoke.md"), "# Spoke\n\nBack to [[Hub]].\n");
  await writeFile(join(root, "archive", "old.md"), "# Old\n\nHidden by settings.\n");
  await writeFile(join(root, "node_modules", "pkg", "readme.md"), "# Dependency\n");
  await writeFile(join(root, ".vscode", "settings.json"),
    '{\n  // comments and trailing commas, as VS Code writes them\n  "vispNotes.exclude": ["**/node_modules/**", "archive/**",],\n}\n');
});

after(async () => {
  await rm(root, { recursive: true, force: true });
});

const call = (vault: Vault, name: string, args: object) =>
  handleMessage({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name, arguments: args } }, vault, "test", () => "2026-09-24");

function text(reply: Awaited<ReturnType<typeof handleMessage>>): string {
  const result = reply?.result as { content: { text: string }[] } | undefined;
  return result?.content.map((part) => part.text).join("") ?? "";
}

test("the vault indexes the folder with the extension's own exclude setting", async () => {
  const snapshot = await new Vault(root).snapshot();
  assert.deepEqual(snapshot.notes.map((note) => note.path).sort(), ["notes/hub.md", "notes/spoke.md"]);
  assert.equal(snapshot.links.filter((link) => link.targetUri !== undefined).length, 2);
});

test("the vault re-reads a note only when it changed, and sees the change", async () => {
  const vault = new Vault(root);
  const first = await vault.snapshot();
  assert.equal(await vault.snapshot(), first, "nothing changed, so the same snapshot is returned");
  const file = join(root, "notes", "spoke.md");
  await writeFile(file, "# Spoke\n\nBack to [[Hub]]. Now with more.\n");
  const later = new Date(Date.now() + 5_000);
  await utimes(file, later, later);
  const second = await vault.snapshot();
  assert.notEqual(second, first);
  assert.match(second.notes.find((note) => note.path === "notes/spoke.md")?.content ?? "", /Now with more/);
});

test("initialize negotiates the protocol version and a notification gets no reply", async () => {
  const vault = new Vault(root);
  const init = await handleMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } }, vault, "1.2.3");
  assert.equal((init?.result as { protocolVersion: string }).protocolVersion, "2025-03-26");
  const unknown = await handleMessage({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } }, vault, "1.2.3");
  assert.equal((unknown?.result as { protocolVersion: string }).protocolVersion, "2025-06-18");
  assert.equal(await handleMessage({ jsonrpc: "2.0", method: "notifications/initialized" }, vault, "1.2.3"), undefined);
  assert.equal((await handleMessage({ jsonrpc: "2.0", id: 3, method: "nope" }, vault, "1"))?.error?.code, -32601);
});

test("tools/list offers the read-only tools, without the editor-only open-note tool", async () => {
  const reply = await handleMessage({ jsonrpc: "2.0", id: 1, method: "tools/list" }, new Vault(root), "1");
  const tools = (reply?.result as { tools: { name: string; annotations: { readOnlyHint: boolean } }[] }).tools;
  assert.deepEqual(tools.map((tool) => tool.name), ["read_note", "search_notes", "note_graph", "link_path", "list_tasks"]);
  assert.ok(tools.every((tool) => tool.annotations.readOnlyHint));
});

test("tools answer from the notes, and a bad call says what went wrong", async () => {
  const vault = new Vault(root);
  assert.match(text(await call(vault, "note_graph", { note: "Hub" })), /Hub links both ways with \*\*Spoke\*\*/);
  assert.match(text(await call(vault, "list_tasks", {})), /Ship it.*\*\*overdue\*\*.*notes\/hub\.md/);
  assert.match(text(await call(vault, "read_note", {})), /No note is open/);
  assert.equal((await call(vault, "delete_everything", {}))?.error?.code, -32602);
});

test("the server speaks MCP over stdio, one message per line", async () => {
  const child = spawn(process.execPath, [join(__dirname, "../../src/mcp/server.js"), "--root", root], { stdio: ["pipe", "pipe", "pipe"] });
  const lines: string[] = [];
  let buffer = "";
  child.stdout.on("data", (chunk: Buffer) => {
    buffer += chunk.toString();
    const parts = buffer.split("\n");
    buffer = parts.pop() ?? "";
    lines.push(...parts.filter(Boolean));
  });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } })}\n`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  child.stdin.write("this is not json\n");
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "search_notes", arguments: { query: "Spoke" } } })}\n`);
  child.stdin.end();
  await new Promise((resolve) => child.on("close", resolve));

  const replies = lines.map((line) => JSON.parse(line) as { id: number | null; result?: unknown; error?: { code: number } });
  assert.equal(replies.length, 3, "two answers and one parse error, nothing for the notification");
  assert.equal(replies[0]?.id, 1);
  assert.equal(replies[1]?.error?.code, -32700);
  assert.equal(replies[2]?.id, 2);
  assert.match(JSON.stringify(replies[2]?.result), /notes\/spoke\.md/);
});

test("a folder can switch agent access off, or withhold notes, from its settings", async () => {
  const folder = await mkdtemp(join(tmpdir(), "visp-mcp-access-"));
  await mkdir(join(folder, ".vscode"), { recursive: true });
  await mkdir(join(folder, "private"), { recursive: true });
  await writeFile(join(folder, "open.md"), "# Open\n\nSee [[Secret]].\n");
  await writeFile(join(folder, "private", "secret.md"), "# Secret\n\nThe launch date.\n");
  const settings = join(folder, ".vscode", "settings.json");
  try {
    await writeFile(settings, '{ "vispNotes.agents.exclude": ["private/**"] }');
    const vault = new Vault(folder);
    assert.match(text(await call(vault, "search_notes", { query: "launch" })), /No notes or tasks match/);
    assert.match(text(await call(vault, "read_note", { note: "Open" })), /not shared with agents/);

    await writeFile(settings, '{ "vispNotes.agents.enabled": false }');
    const list = await handleMessage({ jsonrpc: "2.0", id: 1, method: "tools/list" }, vault, "1");
    assert.deepEqual((list?.result as { tools: unknown[] }).tools, []);
    const refused = await call(vault, "read_note", { note: "Open" });
    assert.equal((refused?.result as { isError: boolean }).isError, true);
    assert.match(text(refused), /turned off/);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
