import assert = require("node:assert/strict");
import { test } from "node:test";
import { tomlString, upsertCodexServer } from "../../src/application/codexConfig";

const server = { command: "node", args: ["/home/me/.config/visp-notes-mcp.js", "--root", "/home/me/notes"] };

test("an empty config gets just the server table", () => {
  assert.equal(upsertCodexServer("", "visp-notes", server),
    "[mcp_servers.visp-notes]\ncommand = 'node'\nargs = ['/home/me/.config/visp-notes-mcp.js', '--root', '/home/me/notes']\n");
});

test("an existing config keeps every other line, comment and table", () => {
  const before = '# my settings\nmodel = "o4"\n\n[mcp_servers.other]\ncommand = "x"\n';
  const after = upsertCodexServer(before, "visp-notes", server);
  assert.ok(after.startsWith(before.trimEnd()), "the original text is untouched");
  assert.match(after, /\n\n\[mcp_servers\.visp-notes\]\ncommand = 'node'\n/);
});

test("the server's own table is replaced in place, however it was quoted", () => {
  const before = '[a]\nx = 1\n\n[mcp_servers."visp-notes"]\ncommand = "old"\nargs = ["old"]\nenv = { A = "1" }\n\n[z]\ny = 2\n';
  const after = upsertCodexServer(before, "visp-notes", server);
  assert.equal(after.match(/visp-notes\]/g)?.length, 1, "no second table");
  assert.doesNotMatch(after, /old|env/);
  assert.match(after, /^\[a\]\nx = 1\n\n\[mcp_servers\.visp-notes\]\ncommand = 'node'\nargs = \[.*\]\n\n\[z\]\ny = 2\n$/);
});

test("Windows paths and awkward strings survive as valid TOML", () => {
  assert.equal(tomlString("C:\\Users\\me\\notes"), "'C:\\Users\\me\\notes'");
  assert.equal(tomlString("it's \"here\"\\"), '"it\'s \\"here\\"\\\\"');
  const crlf = upsertCodexServer("a = 1\r\n", "visp-notes", server);
  assert.ok(crlf.includes("\r\n[mcp_servers.visp-notes]\r\n"), "line endings follow the file");
});
